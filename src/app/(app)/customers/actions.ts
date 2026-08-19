"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { advanceFromFirstStage, deriveLeadStage,
  settleJobsForStage,
} from "@/lib/workflow-engine";
import { requireProfile, assertRole } from "@/lib/auth";
import { normalizePhone } from "@/lib/auth-admin";
import { releaseJobReservations, reverseReceivedPOs } from "@/lib/po-stock";
import { listCustomers } from "@/lib/data/customers";
import {
  type ActivityType,
  type LeadSource,
  type LeadStage,
} from "@/lib/types";

export interface DuplicateMatch {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  reason: "phone" | "email" | "name";
}

export interface CustomerFormState {
  error: string | null;
  ok?: boolean;
  /** Likely-existing customers found on create — the form asks to confirm. */
  duplicates?: DuplicateMatch[];
}

/**
 * Find customers that look like the one being added — same phone (digits),
 * same email, or the exact same name. A soft guard: it warns, it never blocks
 * (two different people can share a name), so the caller can still force-create.
 */
async function findDuplicateCustomers(
  fields: { full_name: string; email: string | null; phone: string | null },
): Promise<DuplicateMatch[]> {
  const name = (fields.full_name || "").trim();
  const email = (fields.email || "").trim().toLowerCase();
  const phone10 = normalizePhone(fields.phone || "");
  const cols = "id, full_name, email, phone, city";
  // Service-role read so it catches EVERY existing customer, even ones a
  // role-scoped user (e.g. a salesman) can't normally see — so the same client
  // can't be added twice across reps.
  const supabase = createAdminClient();
  const rank = { phone: 3, email: 2, name: 1 } as const;
  const found = new Map<string, DuplicateMatch>();
  const add = (
    r: { id: string; full_name: string; email: string | null; phone: string | null; city: string | null },
    reason: DuplicateMatch["reason"],
  ) => {
    const existing = found.get(r.id);
    if (!existing) {
      found.set(r.id, { id: r.id, full_name: r.full_name, email: r.email, phone: r.phone, city: r.city, reason });
    } else if (rank[reason] > rank[existing.reason]) {
      existing.reason = reason;
    }
  };

  const jobs: Promise<void>[] = [];
  type Row = { id: string; full_name: string; email: string | null; phone: string | null; city: string | null };
  if (email)
    jobs.push(
      (async () => {
        const { data } = await supabase.from("customers").select(cols).ilike("email", email).limit(10);
        (data as Row[] | null ?? []).forEach((r) => add(r, "email"));
      })(),
    );
  if (name)
    jobs.push(
      (async () => {
        const { data } = await supabase.from("customers").select(cols).ilike("full_name", name).limit(10);
        (data as Row[] | null ?? []).forEach((r) => add(r, "name"));
      })(),
    );
  if (phone10.length === 10)
    jobs.push(
      (async () => {
        // Narrow by the last 4 digits (bounded), then confirm the full number
        // regardless of how it was formatted when it was saved.
        const { data } = await supabase.from("customers").select(cols).ilike("phone", `%${phone10.slice(-4)}`).limit(50);
        (data as Row[] | null ?? [])
          .filter((r) => normalizePhone(r.phone || "") === phone10)
          .forEach((r) => add(r, "phone"));
      })(),
    );
  await Promise.all(jobs);
  // Strongest signal first.
  return [...found.values()].sort((a, b) => rank[b.reason] - rank[a.reason]);
}

/**
 * Set (or fix) a customer's lead source + drill-down from the inline estimate
 * prompt — a fast, in-place save so a source-less customer can proceed without
 * leaving the page. Never touches other fields.
 */
export async function setCustomerSource(formData: FormData): Promise<CustomerFormState> {
  const id = str(formData.get("customer_id"));
  const source_id = nullable(formData.get("source_id"));
  if (!id) return { error: "Missing customer." };
  if (!source_id) return { error: "Choose where this lead came from." };
  const supabase = await createClient();
  const source = await legacyEnumFor(supabase, source_id);
  const row = {
    source_id,
    source_detail_id: nullable(formData.get("source_detail_id")),
    source_detail_text: nullable(formData.get("source_detail_text")),
    referred_by_customer_id: nullable(formData.get("referred_by_customer_id")),
    source,
  };
  // Enforce the source's required sub-detail (e.g. Referral → who, Facebook → which).
  const { data: src } = await supabase
    .from("lead_sources")
    .select("detail_mode, detail_required")
    .eq("id", source_id)
    .maybeSingle();
  if (src?.detail_required) {
    const filled =
      src.detail_mode === "referrer"
        ? !!(row.source_detail_text || row.referred_by_customer_id)
        : !!(row.source_detail_id || row.source_detail_text);
    if (!filled) return { error: "Add the required detail for this source." };
  }
  const { error } = await supabase.from("customers").update(row).eq("id", id);
  if (error) return { error: error.message };
  refreshCustomerViews(id);
  return { error: null, ok: true };
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullable(v: FormDataEntryValue | null): string | null {
  return str(v) || null;
}

function refreshCustomerViews(id?: string) {
  if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  revalidatePath("/client-status");
  // Anything that changes a customer can change the money picture too.
  revalidatePath("/pulse");
  revalidatePath("/financials");
  revalidatePath("/reports");
}

// The legacy `source` enum values — kept in sync (best-effort) for any code that
// still reads the enum; new sources (instagram, yard_sign…) only set source_id.
const LEGACY_ENUM = new Set([
  "referral", "google", "website", "angi", "facebook", "repeat", "walk_in", "other",
]);

function readCustomerFields(formData: FormData) {
  return {
    full_name: str(formData.get("full_name")),
    company: nullable(formData.get("company")),
    email: nullable(formData.get("email")),
    phone: nullable(formData.get("phone")),
    street: nullable(formData.get("street")),
    city: nullable(formData.get("city")),
    state: nullable(formData.get("state")),
    zip: nullable(formData.get("zip")),
    source_id: nullable(formData.get("source_id")),
    source_detail_id: nullable(formData.get("source_detail_id")),
    source_detail_text: nullable(formData.get("source_detail_text")),
    referred_by_customer_id: nullable(formData.get("referred_by_customer_id")),
    notes: nullable(formData.get("notes")),
  };
}

/** Resolve the legacy `source` enum from a source_id (for backward compat). */
async function legacyEnumFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string | null,
): Promise<LeadSource | null> {
  if (!sourceId) return null;
  try {
    const { data } = await supabase.from("lead_sources").select("key").eq("id", sourceId).maybeSingle();
    const key = data?.key as string | undefined;
    return key && LEGACY_ENUM.has(key) ? (key as LeadSource) : null;
  } catch {
    return null;
  }
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const fields = readCustomerFields(formData);
  if (!fields.full_name) return { error: "A name is required." };
  if (!fields.source_id) {
    return { error: "Please choose where this lead came from." };
  }

  const stage = (str(formData.get("stage")) || "new") as LeadStage;

  const supabase = await createClient();

  // Guard against adding the same customer twice. Unless the user has confirmed
  // ("Create anyway"), surface any likely match so they can open it instead.
  if (str(formData.get("force_create")) !== "1") {
    const duplicates = await findDuplicateCustomers(fields);
    if (duplicates.length) return { error: null, duplicates };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const source = await legacyEnumFor(supabase, fields.source_id);

  const row = { ...fields, source, stage, created_by: user?.id ?? null, assigned_to: user?.id ?? null };
  let { data, error } = await supabase.from("customers").insert(row).select("id").single();
  if (error) {
    // Fallback for before the lead-sources migration (0112): save with the
    // legacy enum only so a customer can still be created.
    const { source_id: _si, source_detail_id: _di, source_detail_text: _dt, referred_by_customer_id: _rb, ...legacy } = row;
    ({ data, error } = await supabase.from("customers").insert(legacy).select("id").single());
  }
  if (error || !data) return { error: error?.message ?? "Could not create the customer." };

  refreshCustomerViews();
  // ?new=1 → the customer file offers the optional "qualify this customer?" pop-up.
  redirect(`/customers/${data.id}?new=1`);
}

export async function updateCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const id = str(formData.get("id"));
  if (!id) return { error: "Missing customer id." };

  const fields = readCustomerFields(formData);
  if (!fields.full_name) return { error: "A name is required." };

  const supabase = await createClient();
  const source = await legacyEnumFor(supabase, fields.source_id);
  const row = { ...fields, source };
  let { error } = await supabase.from("customers").update(row).eq("id", id);
  if (error) {
    const { source_id: _si, source_detail_id: _di, source_detail_text: _dt, referred_by_customer_id: _rb, ...legacy } = row;
    ({ error } = await supabase.from("customers").update(legacy).eq("id", id));
  }
  if (error) return { error: error.message };

  refreshCustomerViews(id);
  return { error: null, ok: true };
}

/** Used as a form `action` from the stage dropdown — no return state needed. */
/** Create a customer portal login linked to this customer record. */
export async function inviteCustomerToPortal(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  // This mints a CONFIRMED auth user bound to a customer record, which grants
  // that customer's whole file via the portal RLS policies. It had no caller
  // check at all — anyone signed in could issue themselves a login onto any
  // customer. Office-and-above only.
  try {
    await assertRole(["admin", "office"]);
  } catch {
    return { error: "You don't have permission to create a portal login." };
  }
  const customerId = str(formData.get("customer_id"));
  const email = str(formData.get("email")).toLowerCase();
  const password = str(formData.get("password"));
  if (!customerId || !email) return { error: "Email is required." };
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();
  const { data: customer } = await supabase
    .from("customers")
    .select("full_name")
    .eq("id", customerId)
    .maybeSingle();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return {
      error:
        "Portal invites need the Supabase secret key configured on the server.",
    };
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: (customer?.full_name as string) ?? null,
      role: "customer",
    },
  });
  if (error || !created.user) {
    return { error: error?.message ?? "Could not create the login." };
  }

  // Link the new login to this customer (and ensure the customer role).
  await admin
    .from("profiles")
    .update({ customer_id: customerId, role: "customer" })
    .eq("id", created.user.id);

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

export async function addActivity(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const customerId = str(formData.get("customer_id"));
  const body = str(formData.get("body"));
  const type = (str(formData.get("type")) || "note") as ActivityType;
  if (!customerId) return { error: "Missing customer." };
  if (!body) return { error: "Write something first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type,
    body,
  });
  if (error) return { error: error.message };

  // Intelligent flow: logging the first contact nudges a brand-new lead forward.
  if (type !== "stage_change") {
    await advanceFromFirstStage(customerId);
  }

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

/**
 * Tick step one — "we've spoken to them" — in a single click.
 *
 * The checklist's first step is proved by a real contact record, not a flag, so
 * this writes the same `activities` row that typing a note by hand would. The
 * Activity tab, the checklist and the pipeline all keep reading the one source
 * of truth, and a brand-new lead still gets nudged off stage one exactly as it
 * does for a hand-written note. Nothing to keep in step afterwards.
 */
export async function markContacted(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "note" satisfies ActivityType,
    body: "Contacted the customer.",
  });
  if (error) return;

  await advanceFromFirstStage(customerId);

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
}

/**
 * Advance (or move) a customer to a workflow stage, assign the owner, set the
 * next-action due date from the stage SLA, log a handoff + activity, and notify
 * the new owner. This is the engine behind the customer command center.
 */
export async function advanceWorkflow(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const toStageId = str(formData.get("to_stage"));
  const toUser = nullable(formData.get("to_user"));
  const note = str(formData.get("note"));
  // Where to land after the move — defaults to the customer file, but the
  // customer LIST passes its own URL so a quick action there stays on the list.
  const redirectTo = nullable(formData.get("redirect_to"));
  if (!id || !toStageId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cust } = await supabase
    .from("customers")
    .select("workflow_stage_id, workflow_owner_id, full_name")
    .eq("id", id)
    .maybeSingle();

  // Pull the target stage plus all anchors so we can keep the legacy
  // lead_stage in lock-step with the workflow stage (one source of truth).
  const { data: allStages } = await supabase
    .from("workflow_stages")
    .select("position, auto_action, name");
  const { data: stage } = await supabase
    .from("workflow_stages")
    .select("name, position, sla_hours, next_action")
    .eq("id", toStageId)
    .maybeSingle();

  const due =
    stage?.sla_hours && stage.sla_hours > 0
      ? new Date(Date.now() + stage.sla_hours * 3600 * 1000).toISOString()
      : null;

  const leadStage = stage
    ? deriveLeadStage(
        { name: stage.name, position: stage.position },
        allStages ?? [],
      )
    : undefined;

  const { error } = await supabase
    .from("customers")
    .update({
      workflow_stage_id: toStageId,
      workflow_owner_id: toUser,
      next_action_due: leadStage === "lost" ? null : due,
      ...(leadStage ? { stage: leadStage } : {}),
      // Moving to a Lost-type stage = the deal fell through: capture the reason
      // (so it shows in Win/Loss) and pull it out of the active pipeline. Moving
      // to any other stage reopens it.
      ...(leadStage === "lost"
        ? {
            cancelled_at: new Date().toISOString(),
            cancel_reason: note || null,
          }
        : leadStage
          ? { cancelled_at: null, cancel_reason: null }
          : {}),
    })
    .eq("id", id);
  if (error) return;

  await supabase.from("handoffs").insert({
    customer_id: id,
    from_stage_id: cust?.workflow_stage_id ?? null,
    to_stage_id: toStageId,
    from_user: cust?.workflow_owner_id ?? null,
    to_user: toUser,
    note: note || null,
  });

  await supabase.from("activities").insert({
    customer_id: id,
    user_id: user?.id ?? null,
    type: "stage_change",
    body: `Moved to "${stage?.name ?? "stage"}"${note ? ` — ${note}` : ""}`,
  });

  // Moving someone to the end of the pipeline by hand must finish their work
  // too — the same rule the auto-advance engine applies. Without this, dragging
  // a customer to Closed left the job scheduled and it stayed on the board, the
  // schedule and the warehouse queue indefinitely.
  if (stage) {
    await settleJobsForStage(
      supabase,
      id,
      { name: stage.name ?? "", position: stage.position ?? 0 },
      (allStages ?? []).map((sst) => ({
        name: (sst.name as string) ?? "",
        position: (sst.position as number) ?? 0,
      })),
    );
    revalidatePath("/jobs");
    revalidatePath("/board");
    revalidatePath("/warehouse");
    revalidatePath("/install-scheduler");
    revalidatePath("/installer");
  }

  // Notify the new owner (best-effort).
  if (toUser && toUser !== user?.id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", toUser)
      .maybeSingle();
    if (prof?.email) {
      await sendEmail({
        to: prof.email,
        subject: `Your turn: ${cust?.full_name ?? "a customer"} — ${stage?.name ?? "next step"}`,
        html: emailLayout(
          "A customer needs your attention",
          `<p>${cust?.full_name ?? "A customer"} is now at <strong>${stage?.name ?? "a new stage"}</strong>.</p>
           <p>Next action: <strong>${stage?.next_action ?? "see the file"}</strong>.</p>
           ${note ? `<p>Note: ${note}</p>` : ""}`,
          { label: "Open customer", url: `${siteUrl()}/customers/${id}` },
        ),
      });
    }
  }

  refreshCustomerViews(id);
  revalidatePath("/client-status");
  // Redirect back so the command-center form closes and the new stage shows.
  redirect(redirectTo ?? `/customers/${id}`);
}

/**
 * OWNER-ONLY override of the action-gate: advance a step whose action isn't
 * complete, for a genuine exception. Requires a reason and is fully LOGGED —
 * who (user_id), when (created_at), which step (from/to stage + label), and why
 * (reason) — in both the handoff trail and the activity feed. Non-owners no-op.
 */
export async function overrideAdvanceWorkflow(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const toStageId = str(formData.get("to_stage"));
  const toUser = nullable(formData.get("to_user"));
  const reason = str(formData.get("reason")).trim();
  const stepLabel = str(formData.get("step_label"));
  const redirectTo = nullable(formData.get("redirect_to"));
  if (!id || !toStageId || !reason) return;

  const profile = await requireProfile();
  if (profile.role !== "admin") return; // owner-only

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cust } = await supabase
    .from("customers")
    .select("workflow_stage_id, workflow_owner_id, full_name")
    .eq("id", id)
    .maybeSingle();
  const { data: allStages } = await supabase
    .from("workflow_stages")
    .select("position, auto_action, name");
  const { data: stage } = await supabase
    .from("workflow_stages")
    .select("name, position, sla_hours, next_action")
    .eq("id", toStageId)
    .maybeSingle();

  const due =
    stage?.sla_hours && stage.sla_hours > 0
      ? new Date(Date.now() + stage.sla_hours * 3600 * 1000).toISOString()
      : null;
  const leadStage = stage
    ? deriveLeadStage({ name: stage.name, position: stage.position }, allStages ?? [])
    : undefined;

  const { error } = await supabase
    .from("customers")
    .update({
      workflow_stage_id: toStageId,
      workflow_owner_id: toUser,
      next_action_due: leadStage === "lost" ? null : due,
      ...(leadStage ? { stage: leadStage } : {}),
    })
    .eq("id", id);
  if (error) return;

  // Audit trail — logged twice for visibility: the handoff record + the feed.
  await supabase.from("handoffs").insert({
    customer_id: id,
    from_stage_id: cust?.workflow_stage_id ?? null,
    to_stage_id: toStageId,
    from_user: cust?.workflow_owner_id ?? null,
    to_user: toUser,
    note: `OWNER OVERRIDE — skipped "${stepLabel || "step"}": ${reason}`,
  });
  await supabase.from("activities").insert({
    customer_id: id,
    user_id: user?.id ?? null,
    type: "system",
    body: `⚠ Owner override by ${profile.full_name ?? "owner"} — advanced past "${stepLabel || stage?.name || "step"}" without completing it. Reason: ${reason}`,
  });

  refreshCustomerViews(id);
  revalidatePath("/client-status");
  redirect(redirectTo ?? `/customers/${id}`);
}

/**
 * Reassign just the owner of a customer (keeps the stage exactly where it is).
 * Logs a handoff + activity and notifies the new owner — the lightweight cousin
 * of advanceWorkflow used by the customer-page quick actions.
 */
export interface ReassignState {
  error: string | null;
  ok?: boolean;
  redirectTo?: string | null;
}

export async function reassignCustomer(
  _prev: ReassignState,
  formData: FormData,
): Promise<ReassignState> {
  const id = str(formData.get("id"));
  const toUser = nullable(formData.get("to_user"));
  const redirectTo = nullable(formData.get("redirect_to"));
  if (!id) return { error: "Missing customer." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cust } = await supabase
    .from("customers")
    .select("workflow_owner_id, workflow_stage_id, full_name, assigned_to")
    .eq("id", id)
    .maybeSingle();

  // Look up who we're assigning to. If they're a SALESPERSON, they also become
  // the permanent account owner (assigned_to) — so the client stays theirs even
  // after it's later passed down to admin/warehouse for a step. Handing a step
  // to Debbie/Fernando (non-sales roles) moves only the current owner.
  let toName: string | null = null;
  let isSalesperson = false;
  if (toUser) {
    const { data: p } = await supabase
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", toUser)
      .maybeSingle();
    toName = (p?.full_name as string) || (p?.email as string) || null;
    isSalesperson = ["salesman", "sales_manager"].includes(
      (p?.role as string) ?? "",
    );
  }

  const patch: Record<string, unknown> = { workflow_owner_id: toUser };
  if (isSalesperson) patch.assigned_to = toUser;

  // No-op only if nothing actually changes.
  const ownerSame = (cust?.workflow_owner_id ?? null) === toUser;
  const salesSame = !isSalesperson || (cust?.assigned_to ?? null) === toUser;
  if (ownerSame && salesSame) {
    refreshCustomerViews(id);
    return { ok: true, error: null, redirectTo };
  }

  const { error } = await supabase.from("customers").update(patch).eq("id", id);
  if (error) return { error: error.message || "Couldn't save the assignment." };

  // A client's booked estimate belongs to their salesperson — so when the owner
  // changes to a salesperson, re-credit their open (scheduled) estimate visits
  // instead of leaving them on whoever booked them.
  if (isSalesperson && !salesSame) {
    await supabase
      .from("appointments")
      .update({ salesperson_id: toUser })
      .eq("customer_id", id)
      .eq("kind", "estimate")
      .eq("status", "scheduled");
  }

  await supabase.from("handoffs").insert({
    customer_id: id,
    from_stage_id: cust?.workflow_stage_id ?? null,
    to_stage_id: cust?.workflow_stage_id ?? null,
    from_user: cust?.workflow_owner_id ?? null,
    to_user: toUser,
    note: "Reassigned",
  });

  await supabase.from("activities").insert({
    customer_id: id,
    user_id: user?.id ?? null,
    type: "system",
    body: toUser
      ? `Reassigned to ${toName ?? "a team member"}.`
      : "Owner unassigned.",
  });

  // Best-effort heads-up to the new owner.
  if (toUser && toUser !== user?.id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", toUser)
      .maybeSingle();
    if (prof?.email) {
      await sendEmail({
        to: prof.email,
        subject: `Assigned to you: ${cust?.full_name ?? "a customer"}`,
        html: emailLayout(
          "A customer was assigned to you",
          `<p>You're now the owner of <strong>${cust?.full_name ?? "a customer"}</strong>.</p>`,
          { label: "Open customer", url: `${siteUrl()}/customers/${id}` },
        ),
      });
    }
  }

  refreshCustomerViews(id);
  return { ok: true, error: null, redirectTo };
}

/** Type-to-search customer lookup for the quick "jump to customer" switcher. */
export async function searchCustomers(
  query: string,
): Promise<{ id: string; name: string; hint: string | null }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await listCustomers({ search: q });
  return rows.slice(0, 10).map((c) => ({
    id: c.id,
    name: c.full_name || c.company || "Customer",
    hint:
      c.phone ||
      c.email ||
      [c.city, c.state].filter(Boolean).join(", ") ||
      null,
  }));
}

/** Cancel a customer/job (deal fell through, no-show, job called off). */
export async function cancelCustomer(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const reason = str(formData.get("reason"));
  const reasonId = nullable(formData.get("reason_id"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Cancelled = its own state: out of the active pipeline (stage → lost), never
  // "won/closed", and excluded from revenue (finance.ts). Store the structured
  // reason id + its label text for clean win/loss-by-reason reporting.
  const base = {
    cancelled_at: new Date().toISOString(),
    cancel_reason: reason || null,
    stage: "lost" as const,
    next_action_due: null,
  };
  let { error } = await supabase
    .from("customers")
    .update({ ...base, cancel_reason_id: reasonId })
    .eq("id", id);
  if (error) {
    // Pre-migration fallback (0126 not run): cancel without the structured id.
    ({ error } = await supabase.from("customers").update(base).eq("id", id));
  }

  // Cancelling the customer must cancel their WORK too, and give back anything
  // the warehouse was holding. This used to stop at the customer row, so a
  // written-off customer's install stayed booked: on the crew's list, in the
  // warehouse queue, and still receiving the day-before reminder — by email AND
  // text — because the cron filters on job status, which nobody had changed.
  const { data: liveJobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", id)
    .not("status", "in", "(completed,cancelled)");
  if (liveJobs?.length) {
    const jobIds = liveJobs.map((j) => j.id as string);
    await releaseJobReservations(supabase, jobIds);
    await supabase.from("jobs").update({ status: "cancelled" }).in("id", jobIds);
    await supabase.from("activities").insert({
      customer_id: id,
      user_id: user?.id ?? null,
      type: "system",
      body: `${jobIds.length} booked job${jobIds.length === 1 ? "" : "s"} cancelled and any reserved material released.`,
    });
  }

  await supabase.from("activities").insert({
    customer_id: id,
    user_id: user?.id ?? null,
    type: "stage_change",
    body: `Customer cancelled${reason ? ` — ${reason}` : ""}.`,
  });

  refreshCustomerViews(id);
  revalidatePath("/client-status");
  revalidatePath("/dashboard");
  // The crew-facing views the customer refresh never covered.
  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/warehouse");
  revalidatePath("/install-scheduler");
  revalidatePath("/installer");
  redirect(`/customers/${id}`);
}

/** Reopen a previously cancelled customer. */
export async function reopenCustomer(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Re-derive the pipeline stage from where they actually are in the workflow,
  // so a reopened customer doesn't stay stuck showing "lost".
  const { data: cust } = await supabase
    .from("customers")
    .select("workflow_stage_id")
    .eq("id", id)
    .maybeSingle();
  let stage: LeadStage = "new";
  if (cust?.workflow_stage_id) {
    const { data: all } = await supabase
      .from("workflow_stages")
      .select("id, position, auto_action, name");
    const current = (all ?? []).find(
      (s) => s.id === cust.workflow_stage_id,
    ) as { name: string | null; position: number } | undefined;
    if (current) stage = deriveLeadStage(current, all ?? []);
  }

  await supabase
    .from("customers")
    .update({ cancelled_at: null, cancel_reason: null, stage })
    .eq("id", id);

  await supabase.from("activities").insert({
    customer_id: id,
    user_id: user?.id ?? null,
    type: "stage_change",
    body: "Customer reopened.",
  });

  refreshCustomerViews(id);
  revalidatePath("/client-status");
  redirect(`/customers/${id}`);
}

/**
 * Permanently delete a customer and everything attached (estimates, jobs,
 * invoices, messages, history) via cascade. Admin/office only; irreversible.
 */
export async function deleteCustomer(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || !["admin", "office"].includes(me.role as string)) return;

  // POs, expenses, and stock movements are set-null (not cascade) on a customer
  // delete, so they'd linger and keep counting as spend/COGS in Business Pulse.
  // Remove them first — by customer and by the customer's estimates/jobs — so
  // deleting a customer truly wipes their financial footprint. (Invoices,
  // payments, jobs, estimates, labor all cascade-delete on their own.)
  const [{ data: ests }, { data: jbs }] = await Promise.all([
    supabase.from("estimates").select("id").eq("customer_id", id),
    supabase.from("jobs").select("id").eq("customer_id", id),
  ]);
  const estIds = (ests ?? []).map((e) => e.id as string);
  const jobIds = (jbs ?? []).map((j) => j.id as string);

  // Before wiping anything, put inventory back so the left hand knows what the
  // right did: (1) free any stock this customer's jobs had reserved, and
  // (2) undo the on-hand a received PO added. Both read records we're about to
  // delete, so they must run FIRST.
  if (jobIds.length) await releaseJobReservations(supabase, jobIds);

  const poIdSet = new Set<string>();
  const collectPoIds = (rows: { id: unknown }[] | null) => {
    for (const r of rows ?? []) if (r.id) poIdSet.add(r.id as string);
  };
  collectPoIds(
    (await supabase.from("purchase_orders").select("id").eq("customer_id", id))
      .data,
  );
  if (estIds.length)
    collectPoIds(
      (
        await supabase
          .from("purchase_orders")
          .select("id")
          .in("estimate_id", estIds)
      ).data,
    );
  if (jobIds.length)
    collectPoIds(
      (await supabase.from("purchase_orders").select("id").in("job_id", jobIds))
        .data,
    );
  const poIds = [...poIdSet];
  if (poIds.length) {
    await reverseReceivedPOs(supabase, poIds);
    await supabase.from("purchase_orders").delete().in("id", poIds);
  }
  if (jobIds.length) {
    await supabase.from("expenses").delete().in("job_id", jobIds);
    await supabase.from("stock_movements").delete().in("job_id", jobIds);
  }

  await supabase.from("customers").delete().eq("id", id);

  refreshCustomerViews();
  redirect("/customers");
}

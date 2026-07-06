"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { advanceFromFirstStage, deriveLeadStage } from "@/lib/workflow-engine";
import { releaseJobReservations, reverseReceivedPOs } from "@/lib/po-stock";
import { listCustomers } from "@/lib/data/customers";
import {
  type ActivityType,
  type LeadSource,
  type LeadStage,
} from "@/lib/types";

export interface CustomerFormState {
  error: string | null;
  ok?: boolean;
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
  revalidatePath("/pipeline");
  // Anything that changes a customer can change the money picture too.
  revalidatePath("/pulse");
  revalidatePath("/financials");
  revalidatePath("/reports");
}

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
    source: (nullable(formData.get("source")) as LeadSource | null) ?? null,
    notes: nullable(formData.get("notes")),
  };
}

export async function createCustomer(
  _prev: CustomerFormState,
  formData: FormData,
): Promise<CustomerFormState> {
  const fields = readCustomerFields(formData);
  if (!fields.full_name) return { error: "A name is required." };
  if (!fields.source) {
    return { error: "Please choose where this lead came from (lead source)." };
  }

  const stage = (str(formData.get("stage")) || "new") as LeadStage;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("customers")
    .insert({
      ...fields,
      stage,
      created_by: user?.id ?? null,
      assigned_to: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  refreshCustomerViews();
  redirect(`/customers/${data.id}`);
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
  const { error } = await supabase.from("customers").update(fields).eq("id", id);
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
  revalidatePath("/pipeline");
  // Redirect back so the command-center form closes and the new stage shows.
  redirect(redirectTo ?? `/customers/${id}`);
}

/**
 * Reassign just the owner of a customer (keeps the stage exactly where it is).
 * Logs a handoff + activity and notifies the new owner — the lightweight cousin
 * of advanceWorkflow used by the customer-page quick actions.
 */
export async function reassignCustomer(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const toUser = nullable(formData.get("to_user"));
  const redirectTo = nullable(formData.get("redirect_to"));
  if (!id) return;

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
    redirect(redirectTo ?? `/customers/${id}`);
  }

  const { error } = await supabase.from("customers").update(patch).eq("id", id);
  if (error) return;

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
  redirect(redirectTo ?? `/customers/${id}`);
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase
    .from("customers")
    .update({
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason || null,
      stage: "lost",
      next_action_due: null,
    })
    .eq("id", id);

  await supabase.from("activities").insert({
    customer_id: id,
    user_id: user?.id ?? null,
    type: "stage_change",
    body: `Customer cancelled${reason ? ` — ${reason}` : ""}.`,
  });

  refreshCustomerViews(id);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
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
  revalidatePath("/pipeline");
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

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { onEstimateDeclined } from "@/app/(app)/estimates/actions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { moveToAutoActionStage } from "@/lib/workflow-engine";
import { ensureJobForEstimate } from "@/app/(app)/jobs/actions";
import { recordEstimateApproval } from "@/lib/data/estimate-approvals";
import { buildApprovalIdempotencyKey } from "@/lib/estimate-approval-idempotency";
import { getInstallAvailability } from "@/lib/data/install-availability";
import { formatDate } from "@/lib/format";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Email the business when a customer responds to an estimate. */
async function notifyOwner(
  supabase: SupabaseServerClient,
  estimateId: string,
  heading: string,
  detailHtml: string,
) {
  const { data: est } = await supabase
    .from("estimates_customer")
    .select("title, customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  let name = "A customer";
  if (est?.customer_id) {
    const { data: cust } = await supabase
      .from("customers")
      .select("full_name")
      .eq("id", est.customer_id)
      .maybeSingle();
    name = (cust?.full_name as string | null) ?? name;
  }
  await sendEmail({
    to: ownerEmail(),
    subject: heading,
    html: emailLayout(
      heading,
      `<p>${name} responded to estimate${est?.title ? ` &ldquo;${est.title}&rdquo;` : ""}.</p>${detailHtml}`,
      { label: "Open in CRM", url: `${siteUrl()}/estimates/${estimateId}` },
    ),
  });
}

export async function portalSendMessage(formData: FormData): Promise<void> {
  const body = str(formData.get("body"));
  if (!body) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("customer_id, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const customerId = prof?.customer_id as string | null;
  if (!customerId) return;

  await supabase.from("messages").insert({
    customer_id: customerId,
    channel: "client",
    author_id: user.id,
    body,
  });

  await sendEmail({
    to: ownerEmail(),
    subject: "New message from a customer",
    html: emailLayout(
      "New customer message",
      `<p>${(prof?.full_name as string) ?? "A customer"} sent a message:</p><p>${body}</p>`,
      { label: "Open in CRM", url: `${siteUrl()}/customers/${customerId}` },
    ),
  });

  revalidatePath("/portal");
  revalidatePath(`/customers/${customerId}`);
}

/**
 * The customer submits PREFERRED install dates — a request, NOT a confirmation.
 * Writes only to install_preferences (+ install_prefs_at); NEVER touches
 * jobs.scheduled_date. Re-validates ownership and availability server-side so a
 * stale/tampered pick can't slip a full day through. The office confirms later.
 */
export async function portalSubmitInstallPreferences(formData: FormData): Promise<void> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("customer_id, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const customerId = prof?.customer_id as string | null;
  if (!customerId) return;

  const admin = createAdminClient();
  // Ownership + not-yet-confirmed guard.
  const { data: job } = await admin
    .from("jobs")
    .select("customer_id, scheduled_date, title")
    .eq("id", jobId)
    .maybeSingle();
  if (!job || job.customer_id !== customerId || job.scheduled_date) return;

  // Re-validate the picks against real availability — drop anything not open.
  const avail = await getInstallAvailability(jobId);
  const open = new Set(avail?.availableStarts ?? []);
  const dates = [...new Set(formData.getAll("dates").map(String).filter(Boolean))]
    .filter((d) => open.has(d))
    .slice(0, 3);
  if (!dates.length) return;

  await admin.from("install_preferences").delete().eq("job_id", jobId);
  await admin.from("install_preferences").insert(
    dates.map((d, i) => ({ job_id: jobId, rank: i + 1, preferred_date: d })),
  );
  await admin.from("jobs").update({ install_prefs_at: new Date().toISOString() }).eq("id", jobId);

  // Notify the office — this is a request awaiting their confirmation.
  const ranked = dates
    .map((d, i) => `${i + 1}) <strong>${formatDate(d)}</strong>`)
    .join("<br/>");
  await sendEmail({
    to: ownerEmail(),
    subject: `Install date request — ${(prof?.full_name as string) ?? "customer"}`,
    html: emailLayout(
      "A customer requested install dates",
      `<p>${(prof?.full_name as string) ?? "A customer"} submitted preferred install dates${
        job.title ? ` for &ldquo;${job.title}&rdquo;` : ""
      } — please confirm one and assign an installer.</p><p>${ranked}</p>`,
      { label: "Open customer", url: `${siteUrl()}/customers/${customerId}` },
    ),
  });

  revalidatePath("/portal");
  revalidatePath(`/customers/${customerId}`);
}

/** A customer's portal action on an estimate must propagate to the staff-facing
 *  estimate/pipeline/dashboard/customer views, not just the portal. */
async function revalidateEstimateStaffViews(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimateId: string,
) {
  const { data: e } = await supabase
    .from("estimates_customer")
    .select("customer_id")
    .eq("id", estimateId)
    .maybeSingle();
  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath("/estimates");
  revalidatePath("/client-status");
  revalidatePath("/dashboard");
  if (e?.customer_id) revalidatePath(`/customers/${e.customer_id}`);
}

export async function portalApproveEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("estimate_id"));
  const optionId = str(formData.get("accepted_option_id")) || null;
  if (!id) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const portalCustomerId = (prof?.customer_id as string | null) ?? null;
  if (!portalCustomerId) {
    redirect(
      `/portal/estimates/${id}?approval_error=${encodeURIComponent(
        "Your account is not linked to a customer profile.",
      )}`,
    );
  }

  // Ownership gate — DB also enforces via my_customer_id() inside
  // record_estimate_approval_safe (0178). Never elevate to service_role for portal.
  const { data: estRow } = await supabase
    .from("estimates_customer")
    .select("customer_id, current_approval_snapshot_id")
    .eq("id", id)
    .maybeSingle();
  if (!estRow?.customer_id || estRow.customer_id !== portalCustomerId) {
    redirect(
      `/portal/estimates/${id}?approval_error=${encodeURIComponent(
        "That estimate is not available for approval.",
      )}`,
    );
  }

  // Snapshot + status atomically via SECURITY DEFINER RPC under the customer JWT.
  const snap = await recordEstimateApproval({
    estimateId: id,
    acceptedOptionId: optionId,
    source: "portal",
    approvedByCustomerId: portalCustomerId,
    admin: false,
    idempotencyKey: buildApprovalIdempotencyKey({
      estimateId: id,
      source: "portal",
      optionId,
      snapshotId:
        (estRow.current_approval_snapshot_id as string | null) ?? null,
      portalCustomerId,
    }),
  });
  if (!snap.snapshotId) {
    // Do not create a job or advance workflow — estimate must remain unapproved.
    revalidatePath(`/portal/estimates/${id}`);
    redirect(
      `/portal/estimates/${id}?approval_error=${encodeURIComponent(
        snap.error ||
          "We couldn’t finalize your approval. Please try again in a moment, or contact us.",
      )}`,
    );
  }

  // Intelligent flow: approved → jump to the "collect deposit" stage.
  const { data: e } = await supabase
    .from("estimates_customer")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (e?.customer_id)
    await moveToAutoActionStage(e.customer_id as string, "collect_deposit");

  // Auto-create the job so the win doesn't stall in the portal (the customer's
  // RLS session can't insert a job, so this runs elevated inside the helper).
  await ensureJobForEstimate(id, null);

  await notifyOwner(
    supabase,
    id,
    "Estimate approved ✅",
    "<p>They approved — time to collect the deposit and order materials.</p>",
  );
  // Also notify the assigned salesperson.
  const { data: cust } = await supabase
    .from("customers")
    .select("assigned_to, workflow_owner_id, full_name")
    .eq("id", portalCustomerId)
    .maybeSingle();
  const repId = cust?.assigned_to ?? cust?.workflow_owner_id ?? null;
  if (repId) {
    const { data: rep } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", repId)
      .maybeSingle();
    if (rep?.email) {
      await sendEmail({
        to: rep.email as string,
        subject: `Your customer approved! — ${cust?.full_name ?? ""}`.trim(),
        html: emailLayout(
          "Your estimate was approved 🎉",
          `<p>${cust?.full_name ?? "Your customer"} approved their estimate. Next: collect the deposit.</p>`,
          { label: "Open estimate", url: `${siteUrl()}/estimates/${id}` },
        ),
      });
    }
  }
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
  await revalidateEstimateStaffViews(supabase, id);
}

export async function portalDeclineEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("estimate_id"));
  if (!id) return;
  const supabase = await createClient();
  const note = str(formData.get("note"));
  await supabase
    .from("estimates")
    .update({ status: "declined", customer_response_note: note || null })
    .eq("id", id);
  // Same follow-through as the staff-side decline — the pipeline must not keep
  // showing a dead lead as awaiting a response.
  await onEstimateDeclined(supabase, id);
  await notifyOwner(
    supabase,
    id,
    "Estimate declined",
    note ? `<p>Reason: ${note}</p>` : "",
  );
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
  await revalidateEstimateStaffViews(supabase, id);
}

export async function portalRequestChanges(formData: FormData): Promise<void> {
  const id = str(formData.get("estimate_id"));
  if (!id) return;
  const supabase = await createClient();
  const note = str(formData.get("note"));
  await supabase
    .from("estimates")
    .update({
      status: "changes_requested",
      customer_response_note: note || null,
    })
    .eq("id", id);
  await notifyOwner(
    supabase,
    id,
    "Changes requested on estimate",
    note ? `<p>What they want: ${note}</p>` : "",
  );
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
  await revalidateEstimateStaffViews(supabase, id);
}

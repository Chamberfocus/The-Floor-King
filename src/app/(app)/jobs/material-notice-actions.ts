"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import {
  canDecideMaterialNotice,
  customerMaterialMessage,
  materialNoticeActivity,
  type MaterialNoticeKind,
} from "@/lib/material-notice";

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Admin, the account owner, or that customer's salesperson tells the customer
 * what the warehouse found — or records that the customer should not be told yet.
 */
export async function sendMaterialNotice(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const jobId = str(formData.get("job_id"));
  const kind = str(formData.get("kind")) as MaterialNoticeKind;
  if (!jobId || (kind !== "all" && kind !== "partial" && kind !== "hold")) {
    return { error: "Choose what the customer should hear." };
  }

  const profile = await requireProfile();
  const admin = createAdminClient();
  const { data: job } = await admin
    .from("jobs")
    .select(
      "id, title, customer_id, workflow_owner_id, warehouse_ready_at, customer:customers(full_name, email, assigned_to, workflow_owner_id)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.customer_id) return { error: "That job no longer exists." };

  const customer = job.customer as unknown as {
    full_name: string | null;
    email: string | null;
    assigned_to: string | null;
    workflow_owner_id: string | null;
  } | null;

  const allowed = canDecideMaterialNotice(profile, {
    salespersonId: customer?.assigned_to ?? null,
    accountOwnerId: customer?.workflow_owner_id ?? null,
    jobOwnerId: (job.workflow_owner_id as string | null) ?? null,
  });
  if (!allowed) {
    return { error: "Only the admin, the account owner, or this customer's salesperson can tell the customer." };
  }

  if (kind === "all" && !job.warehouse_ready_at) {
    return {
      error:
        "The warehouse has not confirmed this material is complete and ready to install.",
    };
  }

  const first = (customer?.full_name ?? "").split(" ")[0] ?? "";
  const title = (job.title as string | null) || "this job";
  let detail = "The customer has not been told yet.";
  if (kind === "all" || kind === "partial") {
    const message = customerMaterialMessage(kind, first);
    detail =
      kind === "all"
        ? "The customer was told that everything has arrived and that someone will call to schedule."
        : "The customer was told that some material has arrived and the rest is still on the way.";
    await admin.from("messages").insert({
      customer_id: job.customer_id,
      channel: "client",
      author_id: profile.id,
      body: message.body,
    });
    const email = (customer?.email ?? "").trim();
    if (email) {
      const safe = message.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    await sendEmail({
        to: email,
        subject: message.subject,
        html: emailLayout(
          message.subject,
          `<p>${safe}</p>`,
          { label: "View your project", url: `${siteUrl()}/portal` },
        ),
      });
    }
  }

  await admin.from("activities").insert({
    customer_id: job.customer_id,
    user_id: profile.id,
    type: "system",
    body: materialNoticeActivity({ jobId, kind, detail: `${detail} (${title})` }),
  });

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/customers/${job.customer_id}`);
  revalidatePath("/warehouse");
  return { error: null };
}

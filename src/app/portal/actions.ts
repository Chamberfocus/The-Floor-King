"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { moveToAutoActionStage } from "@/lib/workflow-engine";

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
    .from("estimates")
    .select("title, customer:customers(full_name)")
    .eq("id", estimateId)
    .maybeSingle();
  const name =
    (est?.customer as unknown as { full_name: string | null } | null)
      ?.full_name ?? "A customer";
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
}

export async function portalApproveEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("estimate_id"));
  const optionId = str(formData.get("accepted_option_id")) || null;
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("estimates")
    .update({ status: "approved", accepted_option_id: optionId })
    .eq("id", id);

  // Intelligent flow: approved → jump to the "collect deposit" stage.
  const { data: e } = await supabase
    .from("estimates")
    .select("customer_id")
    .eq("id", id)
    .maybeSingle();
  if (e?.customer_id)
    await moveToAutoActionStage(e.customer_id as string, "collect_deposit");

  await notifyOwner(
    supabase,
    id,
    "Estimate approved ✅",
    "<p>They approved — time to collect the deposit and order materials.</p>",
  );
  // Also notify the assigned salesperson.
  const { data: est } = await supabase
    .from("estimates")
    .select("customer:customers(assigned_to, workflow_owner_id, full_name)")
    .eq("id", id)
    .maybeSingle();
  const cust = est?.customer as unknown as {
    assigned_to: string | null;
    workflow_owner_id: string | null;
    full_name: string | null;
  } | null;
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
  await notifyOwner(
    supabase,
    id,
    "Estimate declined",
    note ? `<p>Reason: ${note}</p>` : "",
  );
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
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
}

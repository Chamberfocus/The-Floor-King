"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function handoffCustomer(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  const toStage = str(formData.get("to_stage_id")) || null;
  const toUser = str(formData.get("to_user")) || null;
  const note = str(formData.get("note")) || null;
  if (!customerId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cust } = await supabase
    .from("customers")
    .select("workflow_stage_id, full_name")
    .eq("id", customerId)
    .maybeSingle();
  const fromStage = (cust?.workflow_stage_id as string | null) ?? null;

  await supabase
    .from("customers")
    .update({ workflow_stage_id: toStage, workflow_owner_id: toUser })
    .eq("id", customerId);

  await supabase.from("handoffs").insert({
    customer_id: customerId,
    from_stage_id: fromStage,
    to_stage_id: toStage,
    from_user: user?.id ?? null,
    to_user: toUser,
    note,
  });

  if (toUser) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", toUser)
      .maybeSingle();
    let stageName: string | null = null;
    if (toStage) {
      const { data: s } = await supabase
        .from("workflow_stages")
        .select("name")
        .eq("id", toStage)
        .maybeSingle();
      stageName = (s?.name as string) ?? null;
    }
    if (prof?.email) {
      await sendEmail({
        to: prof.email as string,
        subject: `Handoff: ${(cust?.full_name as string) ?? "a client"}`,
        html: emailLayout(
          "A client was handed off to you",
          `<p><strong>${(cust?.full_name as string) ?? "A client"}</strong> is now with you${stageName ? ` for "${stageName}"` : ""}.</p>${note ? `<p>Note: ${note}</p>` : ""}`,
          { label: "Open client", url: `${siteUrl()}/customers/${customerId}` },
        ),
      });
    }
  }

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/pipeline");
}

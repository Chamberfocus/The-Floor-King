"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
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
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
}

export async function portalDeclineEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("estimate_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("estimates")
    .update({
      status: "declined",
      customer_response_note: str(formData.get("note")) || null,
    })
    .eq("id", id);
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
}

export async function portalRequestChanges(formData: FormData): Promise<void> {
  const id = str(formData.get("estimate_id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("estimates")
    .update({
      status: "changes_requested",
      customer_response_note: str(formData.get("note")) || null,
    })
    .eq("id", id);
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/portal");
}

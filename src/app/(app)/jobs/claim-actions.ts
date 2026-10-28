"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** A mill or installer claim stays on the customer's balance and leaves sales. */
export async function setJobClaim(formData: FormData): Promise<void> {
  const id = String(formData.get("job_id") || "");
  if (!id) return;
  await assertRole(["admin", "office", "sales_manager"]);
  const on = String(formData.get("is_claim") || "") === "1";
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ is_claim: on }).eq("id", id);
  revalidatePath(`/jobs/${id}`);
  revalidatePath("/reports/sales-tax");
  revalidatePath("/reports/statements");
  if (error) {
    redirect(
      `/jobs/${id}?job_error=${encodeURIComponent("The claim could not be saved. Add the claims column in Supabase, then try again.")}`,
    );
  }
  redirect(`/jobs/${id}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function saveQualification(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: qs } = await supabase
    .from("qualifying_questions")
    .select("id, label")
    .eq("active", true)
    .order("position", { ascending: true });

  const lines: string[] = [];
  for (const q of qs ?? []) {
    const answer = str(formData.get(`q_${q.id}`));
    if (answer) lines.push(`• ${q.label}\n    ${answer}`);
  }
  const body = lines.length
    ? `Lead qualified:\n${lines.join("\n")}`
    : "Lead marked qualified.";

  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "note",
    body,
  });
  await supabase.from("customers").update({ qualified: true }).eq("id", customerId);

  revalidatePath(`/customers/${customerId}`);
}

export async function skipQualification(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "system",
    body: "Qualification skipped.",
  });
  await supabase.from("customers").update({ qualified: true }).eq("id", customerId);
  revalidatePath(`/customers/${customerId}`);
}

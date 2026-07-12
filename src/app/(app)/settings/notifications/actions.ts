"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const FIELDS = ["notify_staff", "notify_customers"] as const;

export async function setNotifyFlag(formData: FormData): Promise<void> {
  await assertRole(["admin"]);
  const field = String(formData.get("field") ?? "");
  const on = formData.get("on") === "true";
  if (!(FIELDS as readonly string[]).includes(field)) return;
  const supabase = await createClient();
  await supabase.from("business_settings").update({ [field]: on }).eq("id", "default");
  revalidatePath("/settings/notifications");
}

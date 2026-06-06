"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function saveBranding(formData: FormData): Promise<void> {
  const supabase = await createClient();

  const update: Record<string, unknown> = {
    company_name: str(formData.get("company_name")) || "Cleveland Floor King",
    primary_color: str(formData.get("primary_color")) || null,
    phone: str(formData.get("phone")) || null,
    email: str(formData.get("email")) || null,
    address: str(formData.get("address")) || null,
    updated_at: new Date().toISOString(),
  };

  const file = formData.get("logo");
  if (file instanceof File && file.size > 0 && file.size <= 5 * 1024 * 1024) {
    const ext = file.name.split(".").pop() || "png";
    const path = `logo-${crypto.randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from("branding")
      .upload(path, bytes, {
        contentType: file.type || "image/png",
        upsert: true,
      });
    if (!error) {
      const { data } = supabase.storage.from("branding").getPublicUrl(path);
      update.logo_url = data.publicUrl;
    }
  }

  await supabase.from("org_settings").update(update).eq("id", "default");
  revalidatePath("/settings/branding");
  revalidatePath("/", "layout");
}

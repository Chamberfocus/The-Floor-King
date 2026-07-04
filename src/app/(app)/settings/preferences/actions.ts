"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { resolvePreferences } from "@/lib/preferences";
import { disconnectGoogle } from "@/lib/data/google-calendar";

function csv(v: FormDataEntryValue | null): string[] {
  return typeof v === "string"
    ? v.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
}

/**
 * Save the signed-in user's page preferences. Everything is run through
 * resolvePreferences first, so only known keys in a valid order — never an
 * empty list — reach the database.
 */
export async function saveUserPreferences(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const clean = resolvePreferences({
    quick_actions: csv(formData.get("quick_actions")),
    list_actions: csv(formData.get("list_actions")),
    tabs: csv(formData.get("tabs")),
    default_tab:
      typeof formData.get("default_tab") === "string"
        ? (formData.get("default_tab") as string)
        : null,
  });

  await supabase.from("user_preferences").upsert({
    user_id: user.id,
    quick_actions: clean.quickActions,
    list_actions: clean.listActions,
    tabs: clean.tabs,
    default_tab: clean.defaultTab,
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/settings/preferences");
  revalidatePath("/customers");
}

/** Disconnect the signed-in user's Google Calendar (stops future sync). */
export async function disconnectGoogleCalendar(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await disconnectGoogle(user.id);
  revalidatePath("/settings/preferences");
}

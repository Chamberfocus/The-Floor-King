"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { resolvePreferences } from "@/lib/preferences";
import {
  disconnectGoogle,
  listMyCalendars,
  selectTeamCalendarForMe,
  createTeamCalendarForMe,
  clearTeamCalendar,
} from "@/lib/data/google-calendar";

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

// --- Shared team calendar (admin only) -------------------------------------

/** Point the shared team calendar at one of the admin's existing calendars. */
export async function setTeamCalendar(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  if (profile.role !== "admin") return;
  const calendarId = formData.get("calendar_id");
  if (typeof calendarId !== "string" || !calendarId) return;
  // Resolve the human name from the picker's options so the settings UI can
  // show it without another Google round-trip.
  const cals = await listMyCalendars();
  const name = cals.find((c) => c.id === calendarId)?.summary ?? null;
  await selectTeamCalendarForMe(calendarId, name);
  revalidatePath("/settings/preferences");
}

/** Create a fresh "Floor King Schedule" calendar and use it as the team one. */
export async function createTeamCalendar(): Promise<void> {
  const profile = await requireProfile();
  if (profile.role !== "admin") return;
  await createTeamCalendarForMe("Floor King Schedule");
  revalidatePath("/settings/preferences");
}

/** Stop using a shared calendar (jobs go back to each rep's own calendar). */
export async function unsetTeamCalendar(): Promise<void> {
  const profile = await requireProfile();
  if (profile.role !== "admin") return;
  await clearTeamCalendar();
  revalidatePath("/settings/preferences");
}

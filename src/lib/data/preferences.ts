import { createClient } from "@/lib/supabase/server";
import {
  resolvePreferences,
  DEFAULT_PREFERENCES,
  type UserPreferences,
} from "@/lib/preferences";

/**
 * The signed-in user's page preferences, merged with sane defaults. Defensive
 * on purpose: if the user isn't signed in, has no row yet, OR the
 * `user_preferences` table doesn't exist (migration 0067 not run), it quietly
 * returns the defaults — the pages must never break over a missing preference.
 */
export async function getUserPreferences(): Promise<UserPreferences> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ...DEFAULT_PREFERENCES };

    const { data, error } = await supabase
      .from("user_preferences")
      .select("quick_actions, list_actions, tabs, default_tab")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return { ...DEFAULT_PREFERENCES };
    return resolvePreferences(data);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

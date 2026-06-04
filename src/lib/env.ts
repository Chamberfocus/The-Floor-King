/**
 * Centralized access to public Supabase env vars.
 *
 * These are read at request time. We deliberately keep the placeholder fallbacks
 * out of here — if the values are missing in a real environment we want a clear,
 * early error rather than a confusing network failure deep in the Supabase client.
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (see .env.example).",
    );
  }

  return { url, anonKey };
}

/** True once real (non-placeholder) Supabase credentials are configured. */
export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return (
    url.length > 0 &&
    anonKey.length > 0 &&
    !url.includes("placeholder") &&
    !anonKey.includes("placeholder")
  );
}

// next/headers only loads inside a request. Verification scripts import modules
// that mention it at the top level but never call it — they inject their own
// Supabase client instead. Stubbed so the module graph resolves; if anything
// actually calls it, it throws loudly rather than silently faking a session.
export function cookies() {
  throw new Error("next/headers cookies() called outside a request — inject a client instead.");
}
export function headers() {
  throw new Error("next/headers headers() called outside a request.");
}

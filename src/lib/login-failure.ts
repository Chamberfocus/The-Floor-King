/** What the person should read when Supabase rejects the password. */
export function loginFailureMessage(error: { message?: string; code?: string } | null): string {
  const text = `${error?.message ?? ""} ${error?.code ?? ""}`.toLowerCase();
  if (text.includes("ban")) {
    return "This login is turned off. Ask an admin to turn it back on in Team.";
  }
  if (text.includes("not confirmed") || text.includes("email_not_confirmed")) {
    return "This email isn't confirmed yet. Ask an admin to confirm it.";
  }
  return "Incorrect email or password. Please try again.";
}

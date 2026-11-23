/** Session cookies the browser must drop on sign-out. */
export function isAuthCookieName(name: string): boolean {
  return (
    name.startsWith("sb-") ||
    name.includes("-auth-token") ||
    name.endsWith("-code-verifier")
  );
}

export function authCookieNames(cookies: readonly { name: string }[]): string[] {
  return [...new Set(cookies.map((cookie) => cookie.name).filter(isAuthCookieName))];
}

/**
 * The session refresh on these posts was putting the old login back.
 * Sign-out and sign-in write their own cookies. They must not be refreshed first.
 */
export function skipsSessionRefresh(method: string, pathname: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  return pathname === "/auth/signout" || pathname === "/login";
}

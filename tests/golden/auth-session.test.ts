import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { authCookieNames, isAuthCookieName, skipsSessionRefresh } from "@/lib/auth-session";

const root = join(__dirname, "../..");

describe("sign-out session", () => {
  it("drops the supabase auth cookies, including chunks", () => {
    expect(
      authCookieNames([
        { name: "sb-example-auth-token.0" },
        { name: "sb-example-auth-token.1" },
        { name: "sb-example-auth-token-code-verifier" },
        { name: "sidebar" },
      ]),
    ).toEqual([
      "sb-example-auth-token.0",
      "sb-example-auth-token.1",
      "sb-example-auth-token-code-verifier",
    ]);
    expect(isAuthCookieName("theme")).toBe(false);
  });

  it("does not refresh the session while signing in or out", () => {
    expect(skipsSessionRefresh("POST", "/auth/signout")).toBe(true);
    expect(skipsSessionRefresh("POST", "/login")).toBe(true);
    expect(skipsSessionRefresh("GET", "/auth/signout")).toBe(false);
    expect(skipsSessionRefresh("GET", "/login")).toBe(false);
    expect(skipsSessionRefresh("POST", "/home")).toBe(false);
  });

  it("signs out through a request that clears cookies before any refresh", () => {
    const proxy = readFileSync(join(root, "src/lib/supabase/proxy.ts"), "utf8");
    const route = readFileSync(join(root, "src/app/auth/signout/route.ts"), "utf8");
    const button = readFileSync(join(root, "src/components/sign-out-button.tsx"), "utf8");
    const shell = readFileSync(join(root, "src/components/app-shell.tsx"), "utf8");
    expect(proxy).toContain("skipsSessionRefresh");
    expect(proxy.indexOf("skipsSessionRefresh")).toBeLessThan(proxy.indexOf("auth.getUser"));
    expect(route).toContain('signOut({ scope: "global" })');
    expect(route).toContain("authCookieNames");
    expect(route).toContain('status: 303');
    expect(button).toContain('action="/auth/signout"');
    expect(button).toContain('method="post"');
    expect(button).toContain('type="submit"');
    expect(shell).toContain("<SignOutButton");
    expect(shell).not.toContain("action={signout}");
  });
});

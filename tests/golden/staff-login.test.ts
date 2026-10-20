/**
 * Staff sign-in has to open the app. A missing profile must not bounce
 * between /login and /dashboard, and a phone saved with dashes is the same
 * number as the digits the person types.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { phoneLookupValues } from "@/lib/customer-duplicate";
import { loginFailureMessage } from "@/lib/login-failure";

const proxy = readFileSync("src/lib/supabase/proxy.ts", "utf8");
const loginPage = readFileSync("src/app/(auth)/login/page.tsx", "utf8");
const home = readFileSync("src/app/page.tsx", "utf8");

describe("staff login", () => {
  it("treats dashed, parenthesized, and country-code phones as one number", () => {
    const values = phoneLookupValues("(216) 555-1212");
    expect(values).toContain("2165551212");
    expect(values).toContain("216-555-1212");
    expect(values).toContain("+12165551212");
    expect(phoneLookupValues("1-216-555-1212")).toContain("2165551212");
  });

  it("says when a login is turned off instead of calling the password wrong", () => {
    expect(loginFailureMessage({ message: "User is banned", code: "user_banned" })).toContain(
      "turned off",
    );
    expect(loginFailureMessage({ message: "Invalid login credentials" })).toContain(
      "Incorrect email or password",
    );
  });

  it("does not bounce a signed-in person from the login form to the dashboard", () => {
    expect(proxy).not.toContain('redirectUrl.pathname = "/dashboard"');
    expect(loginPage).not.toContain('"/dashboard"');
    expect(loginPage).toContain("if (profile) redirect(destination)");
    expect(loginPage).toContain("This login has no profile");
    expect(home).toContain('redirect("/home")');
  });
});

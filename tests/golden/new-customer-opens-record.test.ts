import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("adding a customer opens that customer", () => {
  it("sends both create forms to the new customer's page", () => {
    const safe = readFileSync("src/app/(app)/new-customer/actions.ts", "utf8");
    expect(safe).toContain("redirect(`/customers/${data.id}?new=1`)");
    expect(safe).not.toContain('redirect("/home")');

    const classic = readFileSync("src/app/(app)/customers/actions.ts", "utf8");
    expect(classic).toContain("redirect(`/customers/${id}?new=1`)");
  });
});

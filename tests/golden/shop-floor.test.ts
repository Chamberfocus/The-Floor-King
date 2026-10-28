import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  dayIsOverCapacity,
  roomSketches,
  shopDatePlus,
  sortPickLines,
  splitSales,
} from "@/lib/shop-floor";

describe("shop floor gaps", () => {
  it("walks the next shop day and sorts the pull by bin then roll", () => {
    expect(shopDatePlus("2026-10-27", 1)).toBe("2026-10-28");
    expect(shopDatePlus("2026-01-31", 1)).toBe("2026-02-01");
    const sorted = sortPickLines([
      { location: "B2", rollNumber: "10", productName: "Oak" },
      { location: "A1", rollNumber: "2", productName: "Pad" },
      { location: "A1", rollNumber: "1", productName: "Carpet" },
      { location: null, rollNumber: null, productName: "Z" },
    ]);
    expect(sorted.map((row) => row.productName)).toEqual(["Carpet", "Pad", "Oak", "Z"]);
  });

  it("keeps claim dollars out of sales and still counts their tax", () => {
    expect(
      splitSales([
        { subtotal: 100, tax: 8, claim: false },
        { subtotal: 40, tax: 3.2, claim: true },
      ]),
    ).toEqual({ sales: 100, salesTax: 8, claimSales: 40, claimTax: 3.2 });
    expect(dayIsOverCapacity(4, 3)).toBe(true);
    expect(dayIsOverCapacity(2, 3)).toBe(false);
    expect(dayIsOverCapacity(5, 0)).toBe(false);
    expect(
      roomSketches([
        { room: "Kitchen", lengthIn: 144, widthIn: 120 },
        { room: "Hall", lengthIn: 0, widthIn: 36 },
      ]),
    ).toEqual([{ name: "Kitchen", lengthIn: 144, widthIn: 120 }]);
  });

  it("wires the morning sheet, the scan, the tax packet, and the claim flag", () => {
    const morning = readFileSync("src/app/(app)/warehouse/morning/page.tsx", "utf8");
    const scan = readFileSync("src/app/(app)/warehouse/scan/page.tsx", "utf8");
    const tags = readFileSync("src/app/(app)/warehouse/tags/page.tsx", "utf8");
    const tax = readFileSync("src/app/(app)/reports/sales-tax/page.tsx", "utf8");
    const statements = readFileSync("src/app/(app)/reports/statements/page.tsx", "utf8");
    const claim = readFileSync("src/app/(app)/jobs/claim-actions.ts", "utf8");
    const sql = readFileSync("supabase/migrations/0504_job_claims.sql", "utf8");
    expect(morning).toContain("loadMorningSheet");
    expect(morning).toContain("Print this sheet");
    expect(scan).toContain("assignRollToJob");
    expect(scan).toContain("shelveRoll");
    expect(tags).toContain("listRollTags");
    expect(tax).toContain("without claims");
    expect(statements).toContain("Customer statements");
    expect(claim).toContain("is_claim");
    expect(sql).toContain("is_claim");
    expect(sql.toLowerCase()).not.toContain("posting_enabled");
    for (const src of [morning, scan, tax, statements, claim]) {
      expect(src).not.toContain("createAdminClient");
    }
  });
});

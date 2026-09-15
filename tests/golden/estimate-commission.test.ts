/**
 * Per-estimate salesperson commission override.
 *
 * Org default remains business_settings.job_commission_pct (% of pre-tax sale).
 * Manual percent or dollars persist independently of unrelated line edits.
 * Customer selling price (lineTotal) is unchanged by commission.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineTotal, type CalcLine } from "@/lib/estimate-calc";
import { allInProfit, jobProfit } from "@/lib/job-profit";
import {
  persistCommissionOverride,
  resolveCommission,
  roleMayEditEstimateCommission,
  roleMayViewEstimateCommission,
} from "@/lib/estimate-commission";
import type { UserRole } from "@/lib/types";

const LINE: CalcLine = {
  line_type: "mat_labor",
  category: "lvp",
  unit: "sq ft",
  measure_unit: "sqft",
  sqft: 100,
  waste_pct: 0,
  material_rate: 5,
  labor_rate: 2,
  material_cost: 3,
  labor_cost: 1,
};

function expectClose(a: number, b: number) {
  expect(a).toBeCloseTo(b, 10);
}

describe("resolveCommission — auto vs override", () => {
  it("no override uses org default % of pre-tax revenue", () => {
    const r = resolveCommission(1000, { defaultPct: 3.5 });
    expect(r.kind).toBe("none");
    expect(r.overridden).toBe(false);
    expectClose(r.commissionPct, 3.5);
    expectClose(r.commission, 35);
  });

  it("percent override persists and does not follow a later org-default change", () => {
    const r = resolveCommission(2000, {
      defaultPct: 3.5,
      overridePct: 5,
    });
    expect(r.kind).toBe("percent");
    expect(r.overridden).toBe(true);
    expectClose(r.commission, 100);
    expectClose(r.commissionPct, 5);
  });

  it("dollar override stays fixed when revenue (unrelated lines) changes", () => {
    const args = { defaultPct: 3.5, overrideAmount: 80 };
    const before = resolveCommission(1000, args);
    const after = resolveCommission(2500, args);
    expect(before.kind).toBe("amount");
    expectClose(before.commission, 80);
    expectClose(after.commission, 80);
    expectClose(after.commissionPct, (80 / 2500) * 100);
  });

  it("amount override wins over percent when both are present", () => {
    const r = resolveCommission(1000, {
      defaultPct: 3.5,
      overridePct: 10,
      overrideAmount: 25,
    });
    expect(r.kind).toBe("amount");
    expectClose(r.commission, 25);
  });

  it("0% and $0 are real overrides, not unset", () => {
    const pct = resolveCommission(1000, { defaultPct: 3.5, overridePct: 0 });
    expect(pct.overridden).toBe(true);
    expectClose(pct.commission, 0);
    const amt = resolveCommission(1000, { defaultPct: 3.5, overrideAmount: 0 });
    expect(amt.overridden).toBe(true);
    expectClose(amt.commission, 0);
  });

  it("empty string / null is auto, not zero", () => {
    const r = resolveCommission(1000, {
      defaultPct: 3.5,
      overridePct: "",
      overrideAmount: "  ",
    });
    expect(r.kind).toBe("none");
    expectClose(r.commission, 35);
  });

  it("reset (both null) returns to org default", () => {
    const overridden = persistCommissionOverride({
      overridePct: 8,
      overrideAmount: null,
    });
    expect(overridden).toEqual({ pct: 8, amount: null });
    const reset = persistCommissionOverride({
      overridePct: "",
      overrideAmount: "",
    });
    expect(reset).toEqual({ pct: null, amount: null });
    const r = resolveCommission(1000, {
      defaultPct: 3.5,
      overridePct: reset.pct,
      overrideAmount: reset.amount,
    });
    expect(r.overridden).toBe(false);
    expectClose(r.commission, 35);
  });

  it("zero revenue yields $0 commission (historic allInProfit guard)", () => {
    const r = resolveCommission(0, { defaultPct: 3.5, overrideAmount: 80 });
    expectClose(r.commission, 0);
  });
});

describe("jobProfit — override does not change customer price", () => {
  it("lineTotal is identical with auto vs manual commission", () => {
    const auto = jobProfit([LINE], { commissionPct: 3.5 });
    const manual = jobProfit([LINE], {
      commissionPct: 3.5,
      commissionOverrideAmount: 200,
    });
    expectClose(lineTotal(LINE), 700);
    expectClose(auto.subtotal, manual.subtotal);
    expectClose(auto.revenue, manual.revenue);
    expect(auto.commission).not.toBe(manual.commission);
    expect(manual.profit).toBeLessThan(auto.profit);
    expect(manual.commissionOverridden).toBe(true);
    expect(auto.commissionOverridden).toBe(false);
  });

  it("percent override scales with revenue; amount override does not", () => {
    const twoLines = [LINE, LINE];
    const pct = jobProfit(twoLines, {
      commissionPct: 3.5,
      commissionOverridePct: 4,
    });
    const amt = jobProfit(twoLines, {
      commissionPct: 3.5,
      commissionOverrideAmount: 50,
    });
    expectClose(pct.revenue, 1400);
    expectClose(pct.commission, 56);
    expectClose(amt.commission, 50);
  });

  it("allInProfit and jobProfit agree on an amount override", () => {
    const viaJob = jobProfit([LINE], {
      commissionPct: 3.5,
      commissionOverrideAmount: 40,
    });
    const viaParts = allInProfit({
      revenue: viaJob.revenue,
      subtotal: viaJob.subtotal,
      discount: viaJob.discount,
      materialBare: 300,
      labor: 100,
      commissionPct: 3.5,
      commissionOverrideAmount: 40,
    });
    expectClose(viaParts.commission, viaJob.commission);
    expectClose(viaParts.profit, viaJob.profit);
    expect(viaParts.commissionKind).toBe("amount");
  });
});

describe("permissions — commission is sales financials only", () => {
  const allowed: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
  const denied: UserRole[] = ["customer", "crew", "warehouse", "scheduler"];

  it("admin / office / sales_manager / salesman may view and edit", () => {
    for (const role of allowed) {
      expect(roleMayViewEstimateCommission(role)).toBe(true);
      expect(roleMayEditEstimateCommission(role)).toBe(true);
    }
  });

  it("customer, installer, warehouse, scheduler may not", () => {
    for (const role of denied) {
      expect(roleMayViewEstimateCommission(role)).toBe(false);
      expect(roleMayEditEstimateCommission(role)).toBe(false);
    }
    expect(roleMayViewEstimateCommission(null)).toBe(false);
  });
});

describe("customer-facing / warehouse / installer surfaces omit commission", () => {
  const ROOT = join(import.meta.dirname, "../..");
  it("portal, warehouse, and installer pages do not mention commission", () => {
    const portal = readFileSync(
      join(ROOT, "src/app/portal/estimates/[id]/page.tsx"),
      "utf8",
    );
    const warehouse = readFileSync(join(ROOT, "src/app/(app)/warehouse/page.tsx"), "utf8");
    const installer = readFileSync(join(ROOT, "src/app/(app)/installer/page.tsx"), "utf8");
    const printDoc = readFileSync(
      join(ROOT, "src/app/(app)/estimates/[id]/estimate-print.tsx"),
      "utf8",
    );
    expect(portal).not.toMatch(/commission/i);
    expect(warehouse).not.toMatch(/commission/i);
    expect(installer).not.toMatch(/commission/i);
    expect(printDoc).not.toMatch(/commission/i);
  });
});


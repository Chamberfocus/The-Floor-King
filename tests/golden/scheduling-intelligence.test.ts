/**
 * Install days follow shop capacity, including prep, subfloor, stairs, and tear-out.
 * The suggested crew must be able to do the trade.
 * Estimate times add drive plus the travel buffer, then snap to an allotted arrival window.
 * Install days skip time off, a missing shift, and a day the crew marked off.
 */
import { describe, expect, it } from "vitest";
import type { EstimateLineItem } from "@/lib/types";
import {
  chooseEstimateInsertion,
  estimateDayWindow,
  installDaysForJob,
  installerClosedRanges,
  workDaySet,
} from "@/lib/scheduling";
import { SCHEDULING_DEFAULTS, suggestionsFromOutlook } from "@/lib/data/scheduling";

function line(partial: Partial<EstimateLineItem> & Pick<EstimateLineItem, "description" | "category">): EstimateLineItem {
  return {
    id: "1",
    option_id: "o",
    position: 0,
    room: null,
    note: null,
    line_type: "mat_labor",
    sqft: null,
    length_in: null,
    width_in: null,
    measure_unit: "sqft",
    material_rate: 0,
    labor_rate: 0,
    installed_rate: null,
    flat_amount: null,
    waste_pct: 0,
    product_id: null,
    manufacturer: null,
    style: null,
    color: null,
    item_no: null,
    material_cost: 0,
    labor_cost: 0,
    quantity: null,
    unit: "sq ft",
    from_stock: false,
    order_as_roll: false,
    roll_width_ft: null,
    sqft_per_box: null,
    is_fill: false,
    is_optional: false,
    measurements: null,
    ...partial,
  };
}

describe("install days use the shop's daily capacity", () => {
  it("sizes LVP from square feet per day and carpet from yardage per day", () => {
    const lvp = installDaysForJob(
      [line({ description: "Hall LVP", category: "lvp", sqft: 500, quantity: 500 })],
      SCHEDULING_DEFAULTS,
    );
    expect(lvp.breakdown[0]).toMatchObject({ label: "LVP / LVT", amount: 500, unit: "sq ft", rate: 250 });
    expect(lvp.days).toBe(2);

    const carpet = installDaysForJob(
      [line({ description: "Living room", category: "carpet", sqft: 900, quantity: 100, unit: "sq yd" })],
      SCHEDULING_DEFAULTS,
    );
    expect(carpet.breakdown[0]).toMatchObject({ label: "Carpet", unit: "sq yd", rate: 100 });
    expect(carpet.days).toBe(1);
  });

  it("adds floor prep, subfloor sheets, and stairs, and counts a self-level pour once", () => {
    const prep = installDaysForJob(
      [
        line({ description: "LVP", category: "lvp", sqft: 250, quantity: 250 }),
        line({ description: "Floor prep — patch / skim coat", category: "labor", sqft: 600, quantity: 600, unit: "sq ft" }),
        line({ description: "Subfloor 1/2", category: "underlayment", sqft: 640, quantity: 20, unit: "sheet" }),
        line({ description: "Stair install — 24 steps (tread + riser)", category: "labor", quantity: 24, unit: "step" }),
        line({ description: "Floor prep — self-leveling", category: "labor", sqft: 300, quantity: 300 }),
        line({ description: "Self-leveler", category: "other", sqft: 300, quantity: 8, unit: "bag" }),
      ],
      SCHEDULING_DEFAULTS,
    );
    const labels = prep.breakdown.map((b) => b.label);
    expect(labels).toContain("Floor prep");
    expect(labels).toContain("Subfloor");
    expect(labels).toContain("Stairs");
    expect(labels.filter((l) => l === "Self-leveling")).toHaveLength(1);
    expect(prep.breakdown.find((b) => b.label === "Subfloor")?.amount).toBe(20);
    expect(prep.breakdown.find((b) => b.label === "Stairs")).toMatchObject({ amount: 24, rate: 12 });
    expect(prep.days).toBeGreaterThan(1);
  });

  it("keeps carpet takeup inside the carpet day and adds hard-surface tear-out and furniture", () => {
    const carpet = installDaysForJob(
      [
        line({ description: "Carpet", category: "carpet", sqft: 450, quantity: 50, unit: "sq yd" }),
        line({ description: "Tear-out — carpet", category: "labor", sqft: 450, quantity: 450 }),
        line({ description: "Furniture moving (heavy)", category: "labor", quantity: 1, unit: "flat" }),
      ],
      SCHEDULING_DEFAULTS,
    );
    expect(carpet.breakdown.map((b) => b.label)).toEqual(["Carpet"]);

    const hard = installDaysForJob(
      [
        line({ description: "LVP", category: "lvp", sqft: 250, quantity: 250 }),
        line({ description: "Tear-out — LVP", category: "labor", sqft: 200, quantity: 200 }),
        line({ description: "Furniture moving (heavy)", category: "labor", quantity: 1, unit: "flat" }),
      ],
      SCHEDULING_DEFAULTS,
    );
    expect(hard.breakdown.map((b) => b.label).sort()).toEqual(["Furniture (heavy)", "LVP / LVT", "Tear-out"]);
    expect(hard.days).toBe(4);
  });
});

describe("the suggested crew can do the job", () => {
  it("offers a hard-surface crew for LVP and skips a carpet-only crew", () => {
    const lines = [line({ description: "LVP", category: "lvp", sqft: 100, quantity: 100 })];
    const outlook = {
      installers: [
        { id: "carpet-crew", name: "Carpet Crew", email: "", role: "crew" },
        { id: "hard-crew", name: "Hard Crew", email: "", role: "crew" },
      ],
      overrides: new Map(),
      booked: new Map(),
      skills: new Map<string, string[]>([
        ["carpet-crew", ["carpet"]],
        ["hard-crew", ["hard"]],
      ]),
    };
    const suggestions = suggestionsFromOutlook(outlook, lines, SCHEDULING_DEFAULTS, "2026-10-19");
    expect(suggestions.map((s) => s.name)).toEqual(["Hard Crew"]);
    expect(suggestions[0]?.fit).toMatch(/hard surface/);
    expect(suggestions[0]?.start).toBe("2026-10-19");
  });

  it("skips time off, a missing shift, and a day the crew marked off", () => {
    const ranges = installerClosedRanges({
      from: "2026-10-19",
      through: "2026-10-25",
      hasShiftSchedule: true,
      shiftWeekdays: new Set([1, 2, 3, 4, 5]),
      overrides: { "2026-10-20": { off: true } },
      timeOff: [{ start: "2026-10-21", end: "2026-10-21" }],
      blocks: [{ start: "2026-10-22", end: "2026-10-22" }],
    });
    expect(ranges).toEqual([
      { start: "2026-10-20", end: "2026-10-22" },
      { start: "2026-10-24", end: "2026-10-25" },
    ]);
    const withSaturdayHours = installerClosedRanges({
      from: "2026-10-19",
      through: "2026-10-25",
      hasShiftSchedule: true,
      shiftWeekdays: new Set([1, 2, 3, 4, 5]),
      overrides: { "2026-10-24": { off: false } },
      timeOff: [],
      blocks: [],
    });
    expect(withSaturdayHours).toEqual([{ start: "2026-10-25", end: "2026-10-25" }]);

    const lines = [line({ description: "LVP", category: "lvp", sqft: 100, quantity: 100 })];
    const suggestions = suggestionsFromOutlook(
      {
        installers: [{ id: "hard-crew", name: "Hard Crew", email: "", role: "crew" }],
        overrides: new Map(),
        booked: new Map(),
        skills: new Map([["hard-crew", ["hard"]]]),
        closed: new Map([["hard-crew", [{ start: "2026-10-19", end: "2026-10-23" }]]]),
      },
      lines,
      SCHEDULING_DEFAULTS,
      "2026-10-19",
    );
    expect(suggestions[0]?.start).toBe("2026-10-24");
    expect(suggestions[0]?.end).toBe("2026-10-24");
  });
});

describe("estimate visits save drive from the store", () => {
  it("picks the insertion that adds the least drive", () => {
    const drive = (from: string, to: string) => {
      const miles: Record<string, number> = {
        "base>new": 5,
        "new>base": 5,
        "s0>new": 10,
        "new>s0": 10,
        "s0>s1": 40,
        "new>s1": 12,
        "s1>new": 12,
        "s1>base": 20,
        "base>s0": 30,
        "base>s1": 50,
      };
      const hit = miles[`${from}>${to}`];
      if (hit == null) return null;
      return { minutes: hit, miles: hit };
    };
    const best = chooseEstimateInsertion({
      dayStart: 9 * 60,
      dayEnd: 17 * 60,
      dur: 60,
      buffer: 15,
      stops: [
        { startMin: 9 * 60 + 15, endMin: 10 * 60, placeKey: "s0" },
        { startMin: 13 * 60 + 20, endMin: 14 * 60, placeKey: "s1" },
      ],
      drive,
      baseLabel: "the store",
    });
    expect(best?.reason).toMatch(/Between/);
    expect(best?.startMin).toBe(10 * 60 + 25);
    expect(best?.detour).toBe(-18);
    expect(best?.reason).toMatch(/store|stop/);
  });

  it("starts the first visit after the drive and the travel buffer", () => {
    const drive = (from: string, to: string) => {
      if (`${from}>${to}` === "base>new" || `${from}>${to}` === "new>base") {
        return { minutes: 20, miles: 12 };
      }
      return null;
    };
    const best = chooseEstimateInsertion({
      dayStart: 9 * 60,
      dayEnd: 17 * 60,
      dur: 60,
      buffer: 30,
      stops: [],
      drive,
    });
    expect(best?.startMin).toBe(9 * 60 + 50);
    expect(best?.endMin).toBe(9 * 60 + 50 + 60);
  });

  it("books the earliest allotted arrival window the drive can reach", () => {
    const drive = (from: string, to: string) => {
      const miles: Record<string, number> = {
        "base>new": 5,
        "new>base": 5,
        "s0>new": 10,
        "new>s0": 10,
        "s0>s1": 40,
        "new>s1": 12,
        "s1>new": 12,
        "s1>base": 20,
        "base>s0": 30,
        "base>s1": 50,
      };
      const hit = miles[`${from}>${to}`];
      if (hit == null) return null;
      return { minutes: hit, miles: hit };
    };
    const windows = [8, 10, 12, 14, 16].map((h) => ({ start: h * 60, end: (h + 2) * 60 }));
    const best = chooseEstimateInsertion({
      dayStart: 9 * 60,
      dayEnd: 17 * 60,
      dur: 60,
      buffer: 15,
      stops: [
        { startMin: 9 * 60 + 15, endMin: 10 * 60, placeKey: "s0" },
        { startMin: 13 * 60 + 20, endMin: 14 * 60, placeKey: "s1" },
      ],
      drive,
      windows,
      baseLabel: "the store",
    });
    expect(best?.reason).toMatch(/After/);
    expect(best?.startMin).toBe(16 * 60);
    expect(best?.endMin).toBe(18 * 60);
  });

  it("does not offer a window that already passed today", () => {
    const drive = (from: string, to: string) =>
      `${from}>${to}` === "base>new" || `${from}>${to}` === "new>base"
        ? { minutes: 10, miles: 6 }
        : null;
    const best = chooseEstimateInsertion({
      dayStart: 9 * 60,
      dayEnd: 17 * 60,
      dur: 60,
      buffer: 15,
      stops: [],
      drive,
      windows: [10, 12, 14, 16].map((h) => ({ start: h * 60, end: (h + 2) * 60 })),
      notBefore: 15 * 60,
    });
    expect(best?.startMin).toBe(16 * 60);
    expect(best?.endMin).toBe(18 * 60);
  });

  it("skips a salesperson who is off or has no shift that day", () => {
    const shop = workDaySet(SCHEDULING_DEFAULTS);
    expect(
      estimateDayWindow({
        date: "2026-10-21",
        shopWorkDays: shop,
        shopStart: "09:00",
        shopEnd: "17:00",
        hasShiftSchedule: false,
        shift: null,
        override: null,
        off: true,
      }),
    ).toBeNull();
    expect(
      estimateDayWindow({
        date: "2026-10-21",
        shopWorkDays: shop,
        shopStart: "09:00",
        shopEnd: "17:00",
        hasShiftSchedule: true,
        shift: null,
        override: null,
        off: false,
      }),
    ).toBeNull();
    expect(
      estimateDayWindow({
        date: "2026-10-21",
        shopWorkDays: shop,
        shopStart: "09:00",
        shopEnd: "17:00",
        hasShiftSchedule: true,
        shift: { start: "10:00", end: "16:00" },
        override: null,
        off: false,
      }),
    ).toEqual({ start: 10 * 60, end: 16 * 60 });
  });
});

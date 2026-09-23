/**
 * Guided Estimate question routing and salesperson takeoff copy.
 * Carpet-only must not ask wet-area / toilet questions. Each family keeps
 * its own follow-ups. Mixed jobs still ask both. Compact takeoff text does
 * not repeat engine clauses. Measured / order / billing math is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeMaterialTakeoff,
  formatCompactRunningTakeoff,
  formatTakeoffStrip,
  questionApplies,
  salespersonTakeoffDisplayRows,
  visibleKnowledgeKeys,
} from "@/lib/flooring-knowledge";

const root = join(__dirname, "../..");

const BANNED =
  /equivalent area|not an order quantity|not an order qty|not sq ft ÷ 9|this number is yards|this number is square feet/i;

function has(keys: string[], key: string): boolean {
  return keys.includes(key);
}

describe("carpet-only question applicability", () => {
  it("hides wet area and toilet pull on stretch-in, glue-down, and carpet tile", () => {
    for (const carpet_install of ["Stretch-in", "Glue-down", "Carpet tile"]) {
      const keys = visibleKnowledgeKeys({
        project_type: ["Carpet"],
        carpet_install: [carpet_install],
        work_type: ["Replacement (tear-out)"],
      });
      expect(has(keys, "wet_area"), carpet_install).toBe(false);
      expect(has(keys, "toilets"), carpet_install).toBe(false);
      expect(has(keys, "appliances"), carpet_install).toBe(false);
      expect(has(keys, "hs_base_trim"), carpet_install).toBe(false);
      expect(has(keys, "tile_setting"), carpet_install).toBe(false);
      expect(has(keys, "vinyl_layout"), carpet_install).toBe(false);
      expect(has(keys, "hardwood_fasteners"), carpet_install).toBe(false);
      expect(has(keys, "hs_transitions"), carpet_install).toBe(false);
      expect(has(keys, "hs_plank_stairs"), carpet_install).toBe(false);
    }
  });

  it("still asks the carpet questions a residential replacement needs", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      work_type: ["Replacement (tear-out)"],
    });
    for (const key of [
      "carpet_cuts",
      "pattern_match",
      "carpet_pad",
      "tack_strip",
      "carpet_stairs",
      "existing_pad",
      "existing_tack",
      "hs_demo",
      "furniture_level",
      "subfloor_condition",
      "substrate",
      "subfloor_condition",
      "radiant_heat",
      "metals_needed",
      "vents_registers",
      "doors_shave",
      "occupancy",
      "access_conditions",
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it("does not treat SQL show_if Carpet as permission to ask toilets", () => {
    expect(
      questionApplies(
        {
          key: "toilets",
          config: { show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
        },
        { project_type: ["Carpet"], carpet_install: ["Stretch-in"] },
      ),
    ).toBe(false);
    expect(
      questionApplies(
        {
          key: "wet_area",
          config: { show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
        },
        { project_type: ["Carpet"], carpet_install: ["Stretch-in"] },
      ),
    ).toBe(false);
  });

  it("leaves wet area and toilets open until a family is chosen", () => {
    const keys = visibleKnowledgeKeys({});
    expect(keys).toContain("wet_area");
    expect(keys).toContain("toilets");
    expect(keys).toContain("appliances");
  });
});

describe("each flooring family keeps its own questions", () => {
  it("sheet vinyl asks layout, adhesive, and bath labor — not carpet or tile", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
      install_method: ["Glue-down"],
    });
    for (const key of ["vinyl_layout", "vinyl_skim", "adhesive", "moisture_test", "wet_area", "toilets", "appliances", "hs_transitions"]) {
      expect(keys, key).toContain(key);
    }
    for (const key of ["tack_strip", "carpet_pad", "carpet_cuts", "tile_setting", "hardwood_fasteners", "attached_pad"]) {
      expect(keys, key).not.toContain(key);
    }
  });

  it("floating LVP asks pad and expansion; glue-down LVP asks adhesive", () => {
    const floating = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Floating / click"],
    });
    expect(floating).toContain("attached_pad");
    expect(floating).toContain("laminate_expansion");
    expect(floating).toContain("wet_area");
    expect(floating).toContain("toilets");
    expect(floating).not.toContain("adhesive");
    expect(floating).not.toContain("tack_strip");
    expect(floating).not.toContain("tile_setting");

    const glue = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Glue-down"],
    });
    expect(glue).toContain("adhesive");
    expect(glue).toContain("acclimation");
    expect(glue).toContain("moisture_test");
    expect(glue).toContain("wet_area");
    expect(glue).toContain("toilets");
    expect(glue).not.toContain("attached_pad");
    expect(glue).not.toContain("tack_strip");
    expect(glue).not.toContain("tile_setting");
  });

  it("laminate stays a floating floor", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(keys).toContain("attached_pad");
    expect(keys).toContain("laminate_expansion");
    expect(keys).toContain("hs_direction");
    expect(keys).toContain("wet_area");
    expect(keys).toContain("toilets");
    expect(keys).not.toContain("adhesive");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("tile_setting");
    expect(keys).not.toContain("hardwood_fasteners");
    expect(keys).not.toContain("acclimation");
  });

  it("nail-down hardwood asks fasteners, finish, and acclimation", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Hardwood"],
      install_method: ["Nail-down"],
    });
    expect(keys).toContain("hardwood_fasteners");
    expect(keys).toContain("hardwood_finish");
    expect(keys).toContain("acclimation");
    expect(keys).toContain("moisture_test");
    expect(keys).toContain("wet_area");
    expect(keys).toContain("toilets");
    expect(keys).toContain("hs_transitions");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("carpet_cuts");
    expect(keys).not.toContain("tile_setting");
    expect(keys).not.toContain("vinyl_layout");
    expect(keys).not.toContain("attached_pad");
  });

  it("floor tile asks setting and bath labor, not a click-floor vapor sheet", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
      tile_application: ["Floor"],
    });
    expect(keys).toContain("tile_application");
    expect(keys).toContain("tile_setting");
    expect(keys).toContain("wet_area");
    expect(keys).toContain("toilets");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("vapor_barrier");
    expect(keys).not.toContain("vinyl_layout");
    expect(keys).not.toContain("carpet_cuts");
  });

  it("carpet tile stays modular and still skips wet area and toilets", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Carpet tile"],
    });
    expect(keys).toContain("adhesive");
    expect(keys).toContain("carpet_tile_stairs");
    expect(keys).toContain("acclimation");
    expect(keys).toContain("moisture_test");
    expect(keys).not.toContain("wet_area");
    expect(keys).not.toContain("toilets");
    expect(keys).not.toContain("appliances");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("pattern_match");
    expect(keys).not.toContain("vapor_barrier");
  });
});

describe("mixed flooring still asks each family", () => {
  it("carpet plus floating LVP keeps carpet cuts and LVP follow-ups, including bath labor", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet", "Hard surface"],
      surface_type: ["LVP / LVT"],
      carpet_install: ["Stretch-in"],
      install_method: ["Floating / click"],
    });
    for (const key of [
      "wet_area",
      "toilets",
      "appliances",
      "carpet_cuts",
      "tack_strip",
      "carpet_pad",
      "attached_pad",
      "laminate_expansion",
      "hs_transitions",
      "hs_plank_stairs",
    ]) {
      expect(keys, key).toContain(key);
    }
    expect(keys).not.toContain("tile_setting");
    expect(keys).not.toContain("hardwood_fasteners");
    expect(keys).not.toContain("vinyl_layout");
  });
});

describe("salesperson takeoff copy", () => {
  it("questionnaire running line is compact and does not defend the math", () => {
    const t = computeMaterialTakeoff({
      family: "carpet",
      measuredSqft: 288,
      cutsSqft: 384,
    });
    expect(t.measured.sqft).toBe(288);
    expect(t.orderSqft).toBe(384);
    expect(t.billingQty).toBe(42.67);
    expect(t.billingUnit).toBe("sqyd");
    expect(t.orderBasis).toBe("cuts");
    expect(t.wastePct).toBe(0);

    const line = formatCompactRunningTakeoff(t);
    expect(line).toBe("Measured: 288 sq ft | Carpet order: 42.67 sq yd");
    expect(line).not.toMatch(BANNED);

    const rows = salespersonTakeoffDisplayRows(t);
    const shown = rows.map((r) => `${r.label}: ${r.value}`).join(" | ");
    expect(shown).toMatch(/Measured: 288 sq ft/);
    expect(shown).toMatch(/Order: 384 sq ft · 42\.67 sq yd/);
    expect(shown).toMatch(/Billing: 42\.67 sq yd/);
    expect(shown).toMatch(/Unit: sq yd/);
    expect(shown).not.toMatch(BANNED);

    const engine = formatTakeoffStrip(t);
    expect(engine).toMatch(/Measured 288 sq ft \(32 sq yd equivalent area — not an order quantity\)/);
    expect(engine).toMatch(/Order 384 sq ft · 42\.67 sq yd \(from cuts — not sq ft ÷ 9\)/);
    expect(engine).toMatch(/Billing 42\.67 sq yd \(this number is yards, not square feet\)/);
    expect(engine).toMatch(/Unit sq yd/);
  });

  it("roll goods without cuts stay TBD in both the compact line and the engine strip", () => {
    const t = computeMaterialTakeoff({
      family: "carpet",
      measuredSqft: 288,
      wastePct: 10,
    });
    expect(t.orderBasis).toBe("none");
    expect(t.orderSqft).toBe(0);
    expect(t.billingQty).toBe(0);
    expect(formatCompactRunningTakeoff(t)).toBe("Measured: 288 sq ft | Carpet order: enter cuts");
    expect(formatCompactRunningTakeoff(t)).not.toMatch(BANNED);
    expect(formatTakeoffStrip(t)).toMatch(/Order TBD — enter cuts \(sq ft ÷ 9 is not an order\)/);
  });

  it("the questionnaire screen uses the compact line, not the engine paragraph", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/formatCompactRunningTakeoff\(t\)/);
    expect(q).toMatch(/salespersonTakeoffDisplayRows\(reviewTakeoff\)/);
    expect(q).not.toMatch(/\{formatTakeoffStrip\(/);
  });
});

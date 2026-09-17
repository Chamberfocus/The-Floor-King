/**
 * Flooring knowledge engine — families, install systems, show_if, measured vs
 * order quantity, carton rounding only when coverage exists.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultWastePct, profileFor } from "@/lib/flooring-profiles";
import {
  accessoryUnitForType,
  billsBySqydFamily,
  cartonTakeoff,
  catalogCategoryForFamily,
  coerceTrimUnit,
  computeMaterialTakeoff,
  cutWidthChoicesFt,
  defaultCutWidthFt,
  equivalentSqyd,
  familyFromCatalogCategory,
  familyFromSurfaceLabel,
  hardwoodConstructionFromLabel,
  hardwoodConstructionFromSpecies,
  installContextFromValByKey,
  installMethodOptionsFor,
  installSystemFromLabel,
  matchesShowIf,
  permittedInstallSystems,
  questionApplies,
  sqydToSqft,
  visibleKnowledgeKeys,
  knowledgeQuestionByKey,
  KNOWLEDGE_QUESTIONS,
} from "@/lib/flooring-knowledge";
import { billsBySquareYard } from "@/lib/units";

const root = process.cwd();

describe("catalog families map onto existing ProductCategory values", () => {
  it("does not invent categories outside the Floor King catalog", () => {
    for (const cat of ["carpet", "lvp", "hardwood", "laminate", "tile", "vinyl"] as const) {
      expect(familyFromCatalogCategory(cat)).toBe(cat);
      expect(catalogCategoryForFamily(cat)).toBe(cat);
    }
    expect(familyFromCatalogCategory("trim")).toBe("other");
  });

  it("maps questionnaire surface labels, including legacy ones", () => {
    expect(familyFromSurfaceLabel("LVP / LVT")).toBe("lvp");
    expect(familyFromSurfaceLabel("LVP / Vinyl")).toBe("lvp");
    expect(familyFromSurfaceLabel("Sheet vinyl")).toBe("vinyl");
    expect(familyFromSurfaceLabel("Engineered")).toBe("hardwood");
    expect(familyFromSurfaceLabel("Engineered hardwood")).toBe("hardwood");
    expect(hardwoodConstructionFromLabel("Engineered hardwood")).toBe("engineered");
    expect(hardwoodConstructionFromLabel("Hardwood")).toBe("solid");
  });
});

describe("install systems differ by family", () => {
  it("laminate is floating only — no adhesive branch", () => {
    expect(permittedInstallSystems("laminate")).toEqual(["floating"]);
    expect(installMethodOptionsFor("laminate").map((o) => o.label)).toEqual(["Floating / click"]);
  });

  it("LVP offers floating, glue, and loose-lay", () => {
    expect(permittedInstallSystems("lvp")).toEqual(["floating", "glue", "loose_lay"]);
  });

  it("engineered hardwood is wider than solid", () => {
    expect(permittedInstallSystems("hardwood", "solid")).toEqual(["nail", "staple", "glue"]);
    expect(permittedInstallSystems("hardwood", "engineered")).toEqual([
      "nail",
      "staple",
      "glue",
      "floating",
    ]);
  });

  it("tile is thinset; sheet vinyl is glue; carpet is stretch/glue/tile", () => {
    expect(permittedInstallSystems("tile")).toEqual(["thinset"]);
    expect(permittedInstallSystems("vinyl")).toEqual(["glue"]);
    expect(permittedInstallSystems("carpet")).toEqual(["stretch_in", "glue", "carpet_tile"]);
  });

  it("parses install labels used by show_if", () => {
    expect(installSystemFromLabel("Glue-down")).toBe("glue");
    expect(installSystemFromLabel("Floating / click")).toBe("floating");
    expect(installSystemFromLabel("Thinset / mortar")).toBe("thinset");
    expect(installSystemFromLabel("Stretch-in")).toBe("stretch_in");
  });
});

describe("measured area vs order quantity", () => {
  it("1 square yard = 9 square feet, labeled as equivalent area not an order", () => {
    expect(equivalentSqyd(450)).toBe(50);
    expect(sqydToSqft(50)).toBe(450);
  });

  it("carpet sqft ÷ 9 is NOT the order quantity without cuts", () => {
    const t = computeMaterialTakeoff({
      family: "carpet",
      measuredSqft: 450,
      wastePct: 10,
    });
    expect(t.measured.sqft).toBe(450);
    expect(t.measured.sqydEquivalent).toBe(50);
    expect(t.orderBasis).toBe("measured_plus_waste_estimated");
    expect(t.billingUnit).toBe("sqyd");
    expect(t.warnings.some((w) => /not a professional carpet cut plan/i.test(w))).toBe(true);
    expect(t.billingQty).not.toBe(50); // 10% waste on 450 sf = 495 sf = 55 yd
    expect(t.billingQty).toBe(55);
  });

  it("carpet cuts ARE the order quantity (no second waste factor)", () => {
    const t = computeMaterialTakeoff({
      family: "carpet",
      measuredSqft: 450,
      cutsSqft: 540, // 15' × 12' + leftover — more than the room
    });
    expect(t.orderBasis).toBe("cuts");
    expect(t.wastePct).toBe(0);
    expect(t.orderSqft).toBe(540);
    expect(t.billingQty).toBe(60);
    expect(t.warnings).toEqual([]);
  });

  it("sheet vinyl is roll goods billed in sq yd, same measured ≠ order rule", () => {
    expect(billsBySqydFamily("vinyl")).toBe(true);
    expect(billsBySquareYard("vinyl")).toBe(true);
    expect(profileFor("vinyl")?.unit).toBe("sqyd");
    const t = computeMaterialTakeoff({ family: "vinyl", measuredSqft: 180 });
    expect(t.billingUnit).toBe("sqyd");
    expect(t.orderBasis).toBe("measured_plus_waste_estimated");
  });

  it("boxed LVP uses waste and carton rounding only when coverage exists", () => {
    const withBox = computeMaterialTakeoff({
      family: "lvp",
      measuredSqft: 500,
      wastePct: 10,
      sqftPerBox: 23.64,
    });
    expect(withBox.measured.sqft).toBe(500);
    expect(withBox.wasteSqft).toBe(50);
    expect(withBox.cartons).toEqual({
      coverageSqft: 23.64,
      cartonCount: 24,
      orderedCoverageSqft: 567.36,
    });
    expect(withBox.orderSqft).toBe(567.36);

    const noBox = computeMaterialTakeoff({
      family: "lvp",
      measuredSqft: 500,
      wastePct: 10,
    });
    expect(noBox.cartons).toBeNull();
    expect(noBox.orderSqft).toBe(550);
    expect(noBox.notes.some((n) => /not invented/i.test(n))).toBe(true);
  });

  it("does not invent carton coverage from zero or missing metadata", () => {
    expect(cartonTakeoff(550, null)).toBeNull();
    expect(cartonTakeoff(550, 0)).toBeNull();
    expect(cartonTakeoff(0, 23.64)).toBeNull();
  });
});

describe("waste is one source of truth", () => {
  it("builder and questionnaire read flooring-profiles, not a second table", () => {
    expect(defaultWastePct("carpet")).toBe(10);
    expect(defaultWastePct("lvp")).toBe(8);
    expect(defaultWastePct("hardwood")).toBe(7);
    expect(defaultWastePct("laminate")).toBe(7);
    expect(defaultWastePct("tile")).toBe(12);
    expect(defaultWastePct("vinyl")).toBe(7);
    const builder = readFileSync(join(root, "src/app/(app)/estimates/estimate-builder.tsx"), "utf8");
    expect(builder).toMatch(/defaultWastePct/);
    expect(builder).not.toMatch(/WASTE_BY_CATEGORY/);
  });
});

describe("show_if all/any + knowledge overlay", () => {
  it("all requires every clause; any requires one", () => {
    const vals = { install_method: ["Floating / click"], attached_pad: ["No"] };
    expect(
      matchesShowIf(
        {
          all: [
            { key: "install_method", in: ["Floating / click"] },
            { key: "attached_pad", in: ["No"] },
          ],
        },
        vals,
      ),
    ).toBe(true);
    expect(
      matchesShowIf(
        {
          all: [
            { key: "install_method", in: ["Floating / click"] },
            { key: "attached_pad", in: ["Yes"] },
          ],
        },
        vals,
      ),
    ).toBe(false);
    expect(
      matchesShowIf(
        { any: [{ key: "install_method", in: ["Glue-down"] }, { key: "surface_type", in: ["Hardwood"] }] },
        { install_method: ["Glue-down"] },
      ),
    ).toBe(true);
  });

  it("hides adhesive on a floating laminate job once the method is known", () => {
    const ctxVals = {
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    };
    expect(
      questionApplies(
        {
          key: "adhesive",
          config: { show_if: { key: "install_method", in: ["Glue-down"] } },
        },
        ctxVals,
      ),
    ).toBe(false);
    expect(
      questionApplies(
        {
          key: "adhesive",
          config: { show_if: { key: "install_method", in: ["Glue-down"] } },
        },
        { ...ctxVals, install_method: ["Glue-down"] },
      ),
    ).toBe(true);
  });

  it("does not hide family-specific questions before surface type is answered", () => {
    expect(
      questionApplies(
        { key: "acclimation", config: {} },
        { project_type: ["Hard surface"] },
      ),
    ).toBe(true);
  });

  it("hides separate underlayment when attached pad is Yes", () => {
    const vals = {
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Floating / click"],
      attached_pad: ["Yes"],
    };
    expect(questionApplies({ key: "hs_underlayment", config: {} }, vals)).toBe(false);
    expect(
      questionApplies(
        { key: "hs_underlayment", config: {} },
        { ...vals, attached_pad: ["No"] },
      ),
    ).toBe(true);
  });
});

describe("install context from questionnaire keys", () => {
  it("treats Engineered hardwood as hardwood + engineered construction", () => {
    const ctx = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Engineered hardwood"],
      install_method: ["Glue-down"],
    });
    expect(ctx.families).toEqual(["hardwood"]);
    expect(ctx.hardwoodConstruction).toBe("engineered");
    expect(ctx.systems).toEqual(["glue"]);
  });
});

describe("questionnaire is wired to the knowledge engine", () => {
  it("uses overlay visibility, takeoff review, and does not treat sqyd as a second copy of sqft", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/questionApplies/);
    expect(q).toMatch(/computeMaterialTakeoff/);
    expect(q).toMatch(/equivalent area — not an order qty/);
    expect(q).toMatch(/Continue to Builder/);
    expect(q).toMatch(/installMethodOptionsForFamilies/);
  });
});

describe("migration 0190 is the knowledge seed (not 0188)", () => {
  it("adds the new question keys and family labels without inventing coverage", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0190_flooring_knowledge_engine.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0190_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/carpet_install/);
    expect(sql).toMatch(/attached_pad/);
    expect(sql).toMatch(/prep_confidence/);
    expect(sql).toMatch(/Field verify \/ TBD/);
    expect(sql).toMatch(/LVP \/ LVT/);
    expect(sql).toMatch(/Sheet vinyl/);
    expect(sql).not.toMatch(/create table public\.products/);
    const migrations = readdirSync(join(root, "supabase/migrations"));
    expect(migrations.some((f) => f.startsWith("0188"))).toBe(false);
  });
});

describe("sheet vinyl, tile, stairs, and existing-bond follow-ups", () => {
  it("vinyl cuts are order quantity in sq yd, separate from carpet cuts", () => {
    const t = computeMaterialTakeoff({
      family: "vinyl",
      measuredSqft: 180,
      cutsSqft: 216,
    });
    expect(t.orderBasis).toBe("cuts");
    expect(t.billingUnit).toBe("sqyd");
    expect(t.billingQty).toBe(24);
    expect(t.warnings).toEqual([]);
  });

  it("tile overlay hides tile_layout on LVP jobs once the surface is known", () => {
    expect(
      questionApplies(
        { key: "tile_layout", config: { show_if: { key: "surface_type", in: ["Tile"] } } },
        { project_type: ["Hard surface"], surface_type: ["LVP / LVT"] },
      ),
    ).toBe(false);
    expect(
      questionApplies(
        { key: "tile_layout", config: { show_if: { key: "surface_type", in: ["Tile"] } } },
        { project_type: ["Hard surface"], surface_type: ["Tile"] },
      ),
    ).toBe(true);
  });

  it("nail/staple fasteners hide on floating laminate", () => {
    expect(
      questionApplies(
        {
          key: "hardwood_fasteners",
          config: { show_if: { key: "install_method", in: ["Nail-down", "Staple-down"] } },
        },
        {
          project_type: ["Hard surface"],
          surface_type: ["Laminate"],
          install_method: ["Floating / click"],
        },
      ),
    ).toBe(false);
  });

  it("0191 parks stair extras after HS stairs and adds vinyl layout", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0191_flooring_knowledge_roll_tile_stairs.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0191_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/position = 265/);
    expect(sql).toMatch(/vinyl_layout/);
    expect(sql).toMatch(/tile_layout/);
    expect(sql).toMatch(/existing_bond/);
    expect(sql).toMatch(/"widths":\[6,12\]/);
    expect(sql).toMatch(/position = 270/);
  });
});

describe("trim / accessory units never mix with area", () => {
  it("quarter round, shoe, and base are linear feet — never square feet", () => {
    expect(accessoryUnitForType("Quarter round")).toBe("lnft");
    expect(accessoryUnitForType("Shoe molding")).toBe("lnft");
    expect(accessoryUnitForType("Baseboard")).toBe("lnft");
    expect(coerceTrimUnit("Quarter round", "sqft")).toBe("lnft");
    expect(coerceTrimUnit("Quarter round", "sq yd")).toBe("lnft");
    expect(coerceTrimUnit("Quarter round", "")).toBe("lnft");
  });

  it("T-mold is each and is not classified as linear molding", () => {
    expect(accessoryUnitForType("T-mold")).toBe("each");
    expect(accessoryUnitForType("Reducer")).toBe("each");
    expect(accessoryUnitForType("Vent / register")).toBe("each");
    expect(coerceTrimUnit("T-mold", "sqft")).toBe("each");
    expect(coerceTrimUnit("Vent / register", "lnft")).toBe("each");
  });
});

describe("tack strip, expansion, and tile setting overlay", () => {
  it("hides tack strip once carpet is glue-down", () => {
    expect(
      questionApplies(
        {
          key: "tack_strip",
          config: { show_if: { key: "project_type", in: ["Carpet"] } },
        },
        { project_type: ["Carpet"], carpet_install: ["Glue-down"] },
      ),
    ).toBe(false);
    expect(
      questionApplies(
        {
          key: "tack_strip",
          config: { show_if: { key: "project_type", in: ["Carpet"] } },
        },
        { project_type: ["Carpet"], carpet_install: ["Stretch-in"] },
      ),
    ).toBe(true);
  });

  it("hides floating expansion on glue-down LVP", () => {
    expect(
      questionApplies(
        {
          key: "laminate_expansion",
          config: { show_if: { key: "install_method", in: ["Floating / click"] } },
        },
        {
          project_type: ["Hard surface"],
          surface_type: ["LVP / LVT"],
          install_method: ["Glue-down"],
        },
      ),
    ).toBe(false);
    expect(
      questionApplies(
        {
          key: "laminate_expansion",
          config: { show_if: { key: "install_method", in: ["Floating / click"] } },
        },
        {
          project_type: ["Hard surface"],
          surface_type: ["Laminate"],
          install_method: ["Floating / click"],
        },
      ),
    ).toBe(true);
  });

  it("hides tile setting materials on laminate", () => {
    expect(
      questionApplies(
        {
          key: "tile_setting",
          config: { show_if: { key: "surface_type", in: ["Tile"] } },
        },
        { project_type: ["Hard surface"], surface_type: ["Laminate"] },
      ),
    ).toBe(false);
  });
});

describe("migration 0192 closes remaining estimator gaps", () => {
  it("keys tack strip, expansion, tile setting, vents without inventing prices", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0192_flooring_knowledge_estimator_gaps.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0192_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/tack_strip/);
    expect(sql).toMatch(/laminate_expansion/);
    expect(sql).toMatch(/tile_setting/);
    expect(sql).toMatch(/vents_registers/);
    expect(sql).toMatch(/Unknown \/ field verify/);
    expect(sql).not.toMatch(/create table public\.products/);
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/coerceTrimUnit/);
    expect(q).toMatch(/never square feet/);
    expect(q).toMatch(/Order \(estimate — not a cut plan\)/);
    expect(q).toMatch(/rollWidthFt/);
    expect(q).toMatch(/defaultCutWidthFt/);
  });
});

describe("product metadata overrides generic roll-width defaults", () => {
  it("uses the catalog roll width when present, and does not invent one", () => {
    expect(
      defaultCutWidthFt({ family: "carpet", productWidthFt: 15, configWidths: [12, 15] }),
    ).toBe(15);
    expect(
      defaultCutWidthFt({ family: "vinyl", productWidthFt: null, configWidths: [6, 12] }),
    ).toBe(6);
    expect(defaultCutWidthFt({ family: "carpet" })).toBe(12);
    expect(cutWidthChoicesFt({ family: "carpet", productWidthFt: 13.5 })).toEqual([12, 13.5, 15]);
    expect(cutWidthChoicesFt({ family: "vinyl", configWidths: [6, 12], productWidthFt: 12 })).toEqual([
      6, 12,
    ]);
  });

  it("reads engineered construction from catalog species text", () => {
    expect(hardwoodConstructionFromSpecies("White oak, engineered")).toBe("engineered");
    expect(hardwoodConstructionFromSpecies("Solid white oak")).toBe("solid");
    expect(hardwoodConstructionFromSpecies(null)).toBe("unknown");
  });
});

describe("family → system asks the right keys (not every question)", () => {
  const has = (keys: string[], k: string) => keys.includes(k);

  it("every registry question has a purpose and vents are each", () => {
    expect(KNOWLEDGE_QUESTIONS.length).toBeGreaterThan(10);
    for (const q of KNOWLEDGE_QUESTIONS) {
      expect(q.purpose).toBeTruthy();
      expect(q.phase).toBeTruthy();
    }
    expect(knowledgeQuestionByKey("vents_registers")?.quantityUnit).toBe("each");
    expect(knowledgeQuestionByKey("tack_strip")?.systems).toEqual(["stretch_in"]);
  });

  it("floating laminate: no adhesive, no fasteners, no tack, expansion on", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(has(keys, "adhesive")).toBe(false);
    expect(has(keys, "hardwood_fasteners")).toBe(false);
    expect(has(keys, "tack_strip")).toBe(false);
    expect(has(keys, "tile_setting")).toBe(false);
    expect(has(keys, "vinyl_layout")).toBe(false);
    expect(has(keys, "laminate_expansion")).toBe(true);
    expect(has(keys, "attached_pad")).toBe(true);
    expect(has(keys, "hs_underlayment")).toBe(true);
  });

  it("glue-down LVP: adhesive on, floating follow-ups off", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Glue-down"],
    });
    expect(has(keys, "adhesive")).toBe(true);
    expect(has(keys, "attached_pad")).toBe(false);
    expect(has(keys, "laminate_expansion")).toBe(false);
    expect(has(keys, "hs_underlayment")).toBe(false);
    expect(has(keys, "hardwood_fasteners")).toBe(false);
    expect(has(keys, "tile_layout")).toBe(false);
  });

  it("stretch-in carpet: tack strip on, adhesive off", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(has(keys, "tack_strip")).toBe(true);
    expect(has(keys, "adhesive")).toBe(false);
    expect(has(keys, "pattern_match")).toBe(true);
    expect(has(keys, "tile_setting")).toBe(false);
  });

  it("glue-down carpet: tack strip off, adhesive on", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(has(keys, "tack_strip")).toBe(false);
    expect(has(keys, "adhesive")).toBe(true);
  });

  it("tile: setting materials and layout, not floating pad", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
    });
    expect(has(keys, "tile_setting")).toBe(true);
    expect(has(keys, "tile_layout")).toBe(true);
    expect(has(keys, "adhesive")).toBe(false);
    expect(has(keys, "attached_pad")).toBe(false);
    expect(has(keys, "laminate_expansion")).toBe(false);
  });

  it("0193 adds subfloor condition without inventing bag counts", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0193_flooring_knowledge_subfloor_condition.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0193_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/subfloor_condition/);
    expect(sql).toMatch(/Unknown \/ field verify/);
    expect(sql).toMatch(/Berber \/ loop/);
    expect(sql).not.toMatch(/create table public\.products/);
    expect(has(visibleKnowledgeKeys({ project_type: ["Hard surface"] }), "subfloor_condition")).toBe(
      true,
    );
  });
});

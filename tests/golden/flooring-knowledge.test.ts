/**
 * Flooring knowledge engine — families, install systems, show_if, measured vs
 * order quantity, carton rounding only when coverage exists.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultWastePct, profileFor } from "@/lib/flooring-profiles";
import { carpetCutList } from "@/lib/job-scope";
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
  formatTakeoffStrip,
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
  resolveQuestionVisibility,
  knowledgeQuestionByKey,
  amountUnitLabelForQuestion,
  knowledgeWarnings,
  knowledgeWhenApplies,
  KNOWLEDGE_QUESTIONS,
  sortEstimateQuestions,
  estimatorPhaseForQuestion,
  estimatorPhaseLabel,
  showIfReferencedKeys,
  prepQuantitiesAreFinal,
  prepQuantitySuffix,
  answerGateValues,
  synthesizeStairGate,
  groupMeasuredSqftByLabel,
  deliveryAddonCost,
  reviewBucketForQuestion,
  formatMeasuredLabel,
  materialWastePctForEmit,
  rollGoodsHaveCuts,
} from "@/lib/flooring-knowledge";
import { billsBySquareYard } from "@/lib/units";
import type { ShowIfClause } from "@/lib/types";

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
    expect(t.orderBasis).toBe("none");
    expect(t.billingUnit).toBe("sqyd");
    expect(t.orderSqft).toBe(0);
    expect(t.billingQty).toBe(0);
    expect(t.wastePct).toBe(0);
    expect(t.warnings.some((w) => /not a professional carpet cut plan/i.test(w))).toBe(true);
    expect(materialWastePctForEmit({ family: "carpet", requestedWastePct: 10 })).toBe(0);
    const strip = formatTakeoffStrip(t);
    expect(strip).toMatch(/Measured 450 sq ft \(50 sq yd equivalent area — not an order quantity\)/);
    expect(strip).toMatch(/Order TBD \(enter cuts — not sq ft ÷ 9\)/);
    expect(strip).not.toMatch(/Order 50 sq yd/);
    expect(strip).not.toMatch(/Order 55/);
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
    const strip = formatTakeoffStrip(t);
    expect(strip).toMatch(/Measured 450 sq ft \(50 sq yd equivalent area — not an order quantity\)/);
    expect(strip).toMatch(/Order 540 sq ft · 60 sq yd \(from cuts/);
    expect(strip).not.toMatch(/Order 50 sq yd[^.]/);
  });

  it("sheet vinyl is roll goods billed in sq yd, same measured ≠ order rule", () => {
    expect(billsBySqydFamily("vinyl")).toBe(true);
    expect(billsBySquareYard("vinyl")).toBe(true);
    expect(profileFor("vinyl")?.unit).toBe("sqyd");
    const t = computeMaterialTakeoff({ family: "vinyl", measuredSqft: 180 });
    expect(t.billingUnit).toBe("sqyd");
    expect(t.orderBasis).toBe("none");
    expect(t.billingQty).toBe(0);
    expect(t.measured.sqydEquivalent).toBe(20);
    expect(materialWastePctForEmit({ family: "vinyl", requestedWastePct: 8 })).toBe(0);
    expect(materialWastePctForEmit({ family: "lvp", requestedWastePct: 10 })).toBe(10);
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
    const strip = formatTakeoffStrip(withBox);
    expect(strip).toMatch(/Measured 500 sq ft/);
    expect(strip).toMatch(/Waste 10% \(50 sq ft\)/);
    expect(strip).toMatch(/Order 567\.36 sq ft \(24 cartons @ 23\.64 sq ft\)/);
    expect(strip).not.toMatch(/sq yd/);
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

  it("acclimation/moisture_test are hardwood OR glue-down, not laminate floating", () => {
    const anyWhen = knowledgeQuestionByKey("acclimation")?.any;
    expect(anyWhen).toEqual([{ families: ["hardwood"] }, { systems: ["glue"] }]);
    expect(knowledgeQuestionByKey("moisture_test")?.any).toEqual(anyWhen);

    const pending = installContextFromValByKey({ project_type: ["Hard surface"] });
    expect(knowledgeWhenApplies({ any: anyWhen }, pending)).toBe(true);

    const lam = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(knowledgeWhenApplies({ any: anyWhen }, lam)).toBe(false);

    const engNail = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Engineered hardwood"],
      install_method: ["Nail-down"],
    });
    expect(knowledgeWhenApplies({ any: anyWhen }, engNail)).toBe(true);

    const lvpGlue = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Glue-down"],
    });
    expect(knowledgeWhenApplies({ any: anyWhen }, lvpGlue)).toBe(true);
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
    expect(q).toMatch(/resolveQuestionVisibility/);
    expect(q).toMatch(/amountUnitLabelForQuestion/);
    expect(q).toMatch(/computeMaterialTakeoff/);
    expect(q).toMatch(/equivalent area — not an order qty/);
    expect(q).toMatch(/Continue to Builder/);
    expect(q).toMatch(/formatTakeoffStrip/);
    expect(q).toMatch(/Running takeoff — measured is not order quantity/);
    expect(q).toMatch(/lineDisplayUnit/);
    expect(q).toMatch(/reviewBucketForQuestion/);
    expect(q).toMatch(/formatMeasuredLabel/);
    expect(q).toMatch(/materialWastePctForEmit/);
    expect(q).toMatch(/order TBD \(enter cuts/);
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
    expect(q).toMatch(/sortEstimateQuestions/);
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
    expect(defaultCutWidthFt({ family: "vinyl" })).toBe(6);
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
    expect(knowledgeQuestionByKey("toilets")?.quantityUnit).toBe("each");
    expect(knowledgeQuestionByKey("appliances")?.quantityUnit).toBe("each");
    expect(knowledgeQuestionByKey("doors_shave")?.quantityUnit).toBe("each");
    expect(knowledgeQuestionByKey("tack_strip")?.systems).toEqual(["stretch_in"]);
    expect(knowledgeQuestionByKey("carpet_pad")?.systems).toEqual(["stretch_in"]);
    expect(amountUnitLabelForQuestion({ key: "toilets", config: { emit: { unit: "sqft" } } })).toBe(
      "each",
    );
    expect(amountUnitLabelForQuestion({ key: "vents_registers" })).toBe("each");
    expect(amountUnitLabelForQuestion({ key: "pattern_repeat" })).toMatch(/inches of repeat/);
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
    expect(has(keys, "hs_direction")).toBe(true);
    expect(has(keys, "acclimation")).toBe(false);
    expect(has(keys, "moisture_test")).toBe(false);
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
    expect(has(keys, "acclimation")).toBe(true);
    expect(has(keys, "moisture_test")).toBe(true);
  });

  it("each family asks its own follow-ups and hides the others", () => {
    const on = (keys: string[], want: string[]) => want.forEach((k) => expect(keys, k).toContain(k));
    const off = (keys: string[], hide: string[]) => hide.forEach((k) => expect(keys, k).not.toContain(k));

    const carpetStretch = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    on(carpetStretch, ["carpet_install", "pattern_match", "tack_strip", "carpet_pad", "existing_pad"]);
    off(carpetStretch, ["adhesive", "attached_pad", "tile_setting", "vinyl_layout", "hardwood_fasteners", "laminate_expansion", "acclimation", "moisture_test", "hs_direction"]);

    const carpetGlue = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    on(carpetGlue, ["adhesive"]);
    off(carpetGlue, ["tack_strip", "carpet_pad", "attached_pad", "tile_layout"]);

    const carpetTile = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Carpet tile"],
    });
    off(carpetTile, ["tack_strip", "carpet_pad", "adhesive", "laminate_expansion"]);

    const lam = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    on(lam, ["attached_pad", "laminate_expansion", "hs_direction"]);
    off(lam, ["adhesive", "hardwood_fasteners", "tile_setting", "vinyl_layout", "tack_strip", "acclimation", "moisture_test"]);

    const lvpGlue = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Glue-down"],
    });
    on(lvpGlue, ["adhesive", "acclimation", "moisture_test"]);
    off(lvpGlue, ["attached_pad", "laminate_expansion", "hardwood_fasteners", "tile_setting"]);

    const engNail = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Engineered hardwood"],
      install_method: ["Nail-down"],
    });
    on(engNail, ["hardwood_fasteners", "acclimation", "moisture_test"]);
    off(engNail, ["adhesive", "attached_pad", "tile_setting", "vinyl_layout"]);

    const vinyl = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
      install_method: ["Glue-down"],
    });
    on(vinyl, ["vinyl_layout", "vinyl_skim", "adhesive", "moisture_test"]);
    off(vinyl, ["attached_pad", "carpet_pad", "tile_application", "hardwood_fasteners"]);

    const tile = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
    });
    on(tile, ["tile_application", "tile_layout", "tile_setting"]);
    off(tile, ["adhesive", "attached_pad", "vinyl_layout", "hardwood_fasteners", "laminate_expansion", "acclimation", "moisture_test", "hs_direction"]);
  });

  it("stretch-in carpet: tack strip on, adhesive off", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(has(keys, "tack_strip")).toBe(true);
    expect(has(keys, "adhesive")).toBe(false);
    expect(has(keys, "pattern_match")).toBe(true);
    expect(has(keys, "carpet_pad")).toBe(true);
    expect(has(keys, "tile_setting")).toBe(false);
    expect(
      has(
        visibleKnowledgeKeys({
          project_type: ["Carpet"],
          carpet_install: ["Stretch-in"],
          pattern_match: ["Pattern match required"],
        }),
        "pattern_repeat",
      ),
    ).toBe(true);
    expect(
      has(
        visibleKnowledgeKeys({
          project_type: ["Carpet"],
          carpet_install: ["Stretch-in"],
          pattern_match: ["No pattern / no match"],
        }),
        "pattern_repeat",
      ),
    ).toBe(false);
  });

  it("glue-down carpet: tack strip off, adhesive on", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(has(keys, "tack_strip")).toBe(false);
    expect(has(keys, "adhesive")).toBe(true);
    expect(has(keys, "carpet_pad")).toBe(false);
  });

  it("tile: setting materials and layout, not floating pad", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
    });
    expect(has(keys, "tile_setting")).toBe(true);
    expect(has(keys, "tile_layout")).toBe(true);
    expect(has(keys, "tile_application")).toBe(true);
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

describe("estimator conversation order (not SQL position)", () => {
  const q = (row: {
    key?: string;
    kind?: string;
    position: number;
    id?: string;
    section?: string;
    show_if?: { key: string; in: string[] };
    trim_list?: boolean;
  }) => ({
    id: row.id ?? row.key ?? `p${row.position}`,
    key: row.key ?? null,
    kind: row.kind ?? "choice",
    section: row.section ?? "",
    position: row.position,
    config: {
      ...(row.show_if ? { show_if: row.show_if } : {}),
      ...(row.trim_list ? { trim_list: true } : {}),
    },
  });

  it("walks area → product → measure → install even when SQL positions are inverted", () => {
    const sorted = sortEstimateQuestions([
      q({
        key: "adhesive",
        position: 1,
        show_if: { key: "install_method", in: ["Glue-down"] },
      }),
      q({ key: "install_method", position: 2 }),
      q({ key: "project_type", position: 50 }),
      q({ key: "pattern_match", position: 3 }),
      q({ key: "surface_type", position: 40 }),
    ]);
    expect(sorted.map((x) => x.key)).toEqual([
      "project_type",
      "surface_type",
      "pattern_match",
      "install_method",
      "adhesive",
    ]);
  });

  it("keeps a show_if gate ahead of its dependent inside the same phase", () => {
    const sorted = sortEstimateQuestions([
      q({
        key: "adhesive",
        position: 1,
        show_if: { key: "install_method", in: ["Glue-down"] },
      }),
      q({ key: "install_method", position: 99 }),
    ]);
    expect(sorted.map((x) => x.key)).toEqual(["install_method", "adhesive"]);
  });

  it("places floor_map after rooms so mixed jobs assign product to measured areas", () => {
    const sorted = sortEstimateQuestions([
      q({ id: "map", kind: "floor_map", position: 10 }),
      q({ id: "rooms", kind: "areas", position: 90, key: "rooms" }),
      q({ key: "project_type", position: 5 }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["project_type", "rooms", "map"]);
  });

  it("puts prep_scope with measure (after area, before rooms) not in front of project_type", () => {
    expect(estimatorPhaseForQuestion(q({ key: "prep_scope", position: 4 }))).toBe("measure");
    const sorted = sortEstimateQuestions([
      q({ key: "prep_scope", position: 4 }),
      q({ key: "project_type", position: 10 }),
      q({ id: "rooms", kind: "areas", position: 20 }),
    ]);
    expect(sorted.map((x) => x.key ?? x.id)).toEqual(["project_type", "prep_scope", "rooms"]);
  });

  it("labels phases for the salesperson rail", () => {
    expect(estimatorPhaseLabel("area")).toBe("Area");
    expect(estimatorPhaseLabel("install")).toBe("Installation");
    expect(showIfReferencedKeys({ all: [{ key: "install_method", in: ["Glue-down"] }, { key: "attached_pad", in: ["No"] }] })).toEqual(
      ["install_method", "attached_pad"],
    );
  });
});

describe("unknown conditions stay unknown", () => {
  it("withholds bag/sheet counts only when prep is field verify / TBD", () => {
    expect(prepQuantitiesAreFinal([])).toBe(true);
    expect(prepQuantitiesAreFinal(["Known"])).toBe(true);
    expect(prepQuantitiesAreFinal(["Estimated"])).toBe(true);
    expect(prepQuantitiesAreFinal(["Allowance"])).toBe(true);
    expect(prepQuantitiesAreFinal(["Field verify / TBD"])).toBe(false);
    expect(prepQuantitySuffix(["Estimated"])).toBe(" (estimated)");
    expect(prepQuantitySuffix(["Allowance"])).toBe(" (allowance)");
    expect(prepQuantitySuffix(["Field verify / TBD"])).toBe("");
  });

  it("classifies live orphan keys instead of dumping them in details", () => {
    expect(knowledgeQuestionByKey("stairs")?.phase).toBe("details");
    expect(knowledgeQuestionByKey("hs_prep")?.phase).toBe("prep");
    expect(knowledgeQuestionByKey("selflevel_needed")?.purpose).toBe("PREP");
    expect(knowledgeQuestionByKey("subfloor_needed")?.purpose).toBe("PREP");
    expect(knowledgeQuestionByKey("climate_control")?.phase).toBe("install");
    expect(knowledgeQuestionByKey("hs_product")).toBeUndefined();
  });

  it("loose-lay LVP does not ask glue or floating follow-ups", () => {
    const keys = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Loose-lay"],
    });
    expect(keys.includes("adhesive")).toBe(false);
    expect(keys.includes("attached_pad")).toBe(false);
    expect(keys.includes("hs_underlayment")).toBe(false);
    expect(keys.includes("laminate_expansion")).toBe(false);
  });

  it("does not invent a hard-surface stair labor rate", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).not.toMatch(/DEFAULT_STAIR_LABOR_PER_SQFT/);
    expect(q).toMatch(/prepQuantitiesAreFinal/);
    expect(q).toMatch(/labor rate TBD/);
    expect(q).not.toMatch(/derive one cut from the area @ 12/);
    expect(q).not.toMatch(/width_in: 144/);
    const scope = readFileSync(join(root, "src/lib/job-scope.ts"), "utf8");
    expect(scope).not.toMatch(/Derive one cut from the area at the roll/);
    const fake = carpetCutList([
      {
        room: "Living",
        description: "Mohawk",
        category: "carpet",
        length_in: null,
        width_in: null,
        sqft: 450,
        roll_width_ft: 12,
        measurements: null,
      },
    ]);
    expect(fake.cuts).toEqual([]);
    expect(fake.totalSqyd).toBe(0);
    const real = carpetCutList([
      {
        room: "Living",
        description: "Mohawk",
        category: "carpet",
        length_in: 25 * 12,
        width_in: 12 * 12,
        sqft: 300,
        roll_width_ft: 12,
        measurements: [{ label: "Living", length_in: 25 * 12, width_in: 12 * 12, op: "add" }],
      },
    ]);
    expect(real.cuts.length).toBe(1);
    expect(real.totalSqyd).toBeGreaterThan(0);
  });
});

describe("SQL show_if + overlay + phase sort (no live database)", () => {
  /** Configs copied from 0190–0194 so the walk matches what owner apply installs. */
  const catalogRows: { key: string; position: number; show_if: ShowIfClause | null }[] = [
    { key: "project_type", position: 10, show_if: null },
    { key: "surface_type", position: 200, show_if: { key: "project_type", in: ["Hard surface"] } },
    { key: "install_method", position: 205, show_if: { key: "project_type", in: ["Hard surface"] } },
    { key: "carpet_install", position: 105, show_if: { key: "project_type", in: ["Carpet"] } },
    { key: "pattern_match", position: 106, show_if: { key: "project_type", in: ["Carpet"] } },
    {
      key: "pattern_repeat",
      position: 107,
      show_if: { key: "pattern_match", in: ["Pattern match required"] },
    },
    { key: "tack_strip", position: 109, show_if: { key: "project_type", in: ["Carpet"] } },
    {
      key: "attached_pad",
      position: 206,
      show_if: { key: "install_method", in: ["Floating / click"] },
    },
    {
      key: "adhesive",
      position: 225,
      show_if: {
        any: [
          { key: "install_method", in: ["Glue-down"] },
          { key: "carpet_install", in: ["Glue-down"] },
        ],
      },
    },
    {
      key: "hs_underlayment",
      position: 220,
      show_if: { key: "install_method", in: ["Floating / click"] },
    },
    {
      key: "laminate_expansion",
      position: 217,
      show_if: { key: "install_method", in: ["Floating / click"] },
    },
    {
      key: "hardwood_fasteners",
      position: 228,
      show_if: { key: "install_method", in: ["Nail-down", "Staple-down"] },
    },
    {
      key: "acclimation",
      position: 230,
      show_if: {
        any: [
          { key: "surface_type", in: ["Hardwood", "Engineered hardwood"] },
          { key: "install_method", in: ["Glue-down"] },
        ],
      },
    },
    {
      key: "moisture_test",
      position: 235,
      show_if: {
        any: [
          { key: "install_method", in: ["Glue-down"] },
          { key: "surface_type", in: ["Hardwood", "Engineered hardwood"] },
        ],
      },
    },
    { key: "vinyl_layout", position: 216, show_if: { key: "surface_type", in: ["Sheet vinyl"] } },
    { key: "vinyl_skim", position: 353, show_if: { key: "surface_type", in: ["Sheet vinyl"] } },
    { key: "tile_application", position: 217, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "tile_layout", position: 218, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "tile_setting", position: 219, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "subfloor_condition", position: 352, show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
    { key: "carpet_pad", position: 110, show_if: { key: "project_type", in: ["Carpet"] } },
    { key: "toilets", position: 255, show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
    { key: "appliances", position: 260, show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
    { key: "delivery_scope", position: 535, show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
    { key: "carpet_stairs", position: 250, show_if: { key: "project_type", in: ["Carpet"] } },
    { key: "hs_plank_stairs", position: 250, show_if: { key: "project_type", in: ["Hard surface"] } },
    {
      key: "stair_landings",
      position: 265,
      show_if: {
        any: [
          { key: "stairs", in: ["Yes"] },
          { key: "carpet_stairs", in: ["Yes"] },
          { key: "hs_plank_stairs", in: ["Yes"] },
        ],
      },
    },
    {
      key: "stair_open_sides",
      position: 266,
      show_if: {
        any: [
          { key: "stairs", in: ["Yes"] },
          { key: "carpet_stairs", in: ["Yes"] },
          { key: "hs_plank_stairs", in: ["Yes"] },
        ],
      },
    },
    {
      key: "hs_direction",
      position: 214,
      show_if: { key: "surface_type", in: ["Laminate", "LVP / LVT", "Hardwood", "Engineered hardwood"] },
    },
    {
      key: "hs_demo",
      position: 270,
      show_if: { key: "project_type", in: ["Hard surface"] },
    },
    {
      key: "substrate",
      position: 350,
      show_if: { key: "project_type", in: ["Hard surface"] },
    },
    {
      key: "vapor_barrier",
      position: 207,
      show_if: {
        any: [
          { key: "install_method", in: ["Floating / click", "Glue-down"] },
          { key: "substrate", in: ["Concrete"] },
        ],
      },
    },
    {
      key: "asbestos_risk",
      position: 277,
      show_if: {
        key: "hs_demo",
        in: ["Ceramic WITH mortar bed", "Ceramic WITHOUT mortar bed", "Sheet vinyl"],
      },
    },
  ];
  const catalog = catalogRows.map((row) => ({
    id: row.key,
    key: row.key,
    kind: "choice",
    section: "",
    position: row.position,
    config: { show_if: row.show_if },
  }));

  const walk = (answers: Record<string, string[]>) => {
    const vis = resolveQuestionVisibility(catalog, (q) => (q.key && answers[q.key]) || []);
    return sortEstimateQuestions(catalog.filter((q) => vis[q.id])).map((q) => q.key);
  };

  it("floating laminate: expansion and attached pad, no adhesive or fasteners", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(keys.indexOf("project_type")).toBeLessThan(keys.indexOf("surface_type")!);
    expect(keys.indexOf("surface_type")).toBeLessThan(keys.indexOf("install_method")!);
    expect(keys.indexOf("install_method")).toBeLessThan(keys.indexOf("attached_pad")!);
    expect(keys).toContain("laminate_expansion");
    expect(keys).toContain("hs_underlayment");
    expect(keys).toContain("hs_direction");
    expect(keys).not.toContain("adhesive");
    expect(keys).not.toContain("hardwood_fasteners");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("tile_setting");
    expect(keys).not.toContain("vinyl_layout");
    expect(keys).not.toContain("carpet_install");
    expect(keys).not.toContain("acclimation");
    expect(keys).not.toContain("moisture_test");
  });

  it("glue-down LVP: adhesive on, floating follow-ups off", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Glue-down"],
    });
    expect(keys).toContain("adhesive");
    expect(keys).toContain("acclimation");
    expect(keys).toContain("moisture_test");
    expect(keys).not.toContain("attached_pad");
    expect(keys).not.toContain("laminate_expansion");
    expect(keys).not.toContain("hs_underlayment");
  });

  it("stretch-in carpet: tack strip on via overlay, adhesive off", () => {
    const keys = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(keys).toContain("tack_strip");
    expect(keys).toContain("pattern_match");
    expect(keys).toContain("carpet_pad");
    expect(keys).toContain("toilets");
    expect(keys).not.toContain("pattern_repeat");
    expect(keys).not.toContain("adhesive");
    expect(keys).not.toContain("surface_type");
    expect(keys).not.toContain("stair_landings");
    expect(keys).not.toContain("stair_open_sides");
  });

  it("vapor_barrier: floating or concrete; not nail-down over plywood", () => {
    expect(
      walk({
        project_type: ["Hard surface"],
        surface_type: ["Laminate"],
        install_method: ["Floating / click"],
      }),
    ).toContain("vapor_barrier");
    expect(
      walk({
        project_type: ["Hard surface"],
        surface_type: ["Hardwood"],
        install_method: ["Nail-down"],
        substrate: ["Concrete"],
      }),
    ).toContain("vapor_barrier");
    expect(
      walk({
        project_type: ["Hard surface"],
        surface_type: ["Hardwood"],
        install_method: ["Nail-down"],
        substrate: ["Plywood / OSB"],
      }),
    ).not.toContain("vapor_barrier");
    expect(
      walk({
        project_type: ["Carpet"],
        carpet_install: ["Stretch-in"],
      }),
    ).not.toContain("vapor_barrier");
  });

  it("glue-down carpet: overlay hides tack strip even though show_if is Carpet", () => {
    const keys = walk({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(keys).toContain("adhesive");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("carpet_pad");
  });

  it("attached pad Yes hides separate underlayment", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
      attached_pad: ["Yes"],
    });
    expect(keys).toContain("attached_pad");
    expect(keys).not.toContain("hs_underlayment");
  });

  it("sheet vinyl: layout + skim, no carton pad questions", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
      install_method: ["Glue-down"],
    });
    expect(keys).toContain("vinyl_layout");
    expect(keys).toContain("vinyl_skim");
    expect(keys).toContain("adhesive");
    expect(keys).not.toContain("attached_pad");
    expect(keys).not.toContain("tile_application");
    expect(keys).not.toContain("carpet_pad");
    expect(keys).not.toContain("hs_direction");
  });

  it("asbestos risk only after ceramic or sheet-vinyl demo", () => {
    const without = walk({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Floating / click"],
      hs_demo: ["LVP"],
    });
    expect(without).not.toContain("asbestos_risk");
    const withVinyl = walk({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
      install_method: ["Glue-down"],
      hs_demo: ["Sheet vinyl"],
    });
    expect(withVinyl).toContain("asbestos_risk");
  });

  it("tile: floor vs wall before layout, no floating follow-ups", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
    });
    expect(keys.indexOf("tile_application")).toBeLessThan(keys.indexOf("tile_layout")!);
    expect(keys).toContain("tile_setting");
    expect(keys).not.toContain("attached_pad");
    expect(keys).not.toContain("vinyl_skim");
    expect(keys).not.toContain("hs_direction");
    expect(keys).not.toContain("asbestos_risk");
  });

  it("pattern repeat only after pattern match is required", () => {
    const without = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      pattern_match: ["No pattern / no match"],
    });
    expect(without).not.toContain("pattern_repeat");
    const withMatch = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      pattern_match: ["Pattern match required"],
    });
    expect(withMatch).toContain("pattern_repeat");
    expect(withMatch.indexOf("pattern_match")).toBeLessThan(withMatch.indexOf("pattern_repeat")!);
  });

  it("stair landings appear after a carpet step count, not on the dead stairs yes/no", () => {
    const before = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(before).toContain("carpet_stairs");
    expect(before).not.toContain("stair_landings");
    const after = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      carpet_stairs: ["Yes"],
    });
    expect(after).toContain("stair_landings");
    expect(after).toContain("stair_open_sides");
    expect(after.indexOf("carpet_stairs")).toBeLessThan(after.indexOf("stair_landings")!);
  });

  it("unanswered attached pad still shows underlayment on a floating job", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(keys).toContain("hs_underlayment");
  });
});

describe("0194 keys live questions without inventing prices", () => {
  it("keys pad/toilets/appliances and adds tile vs wall + vinyl skim", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0194_flooring_knowledge_job_conditions.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0194_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/carpet_pad/);
    expect(sql).toMatch(/tile_application/);
    expect(sql).toMatch(/vinyl_skim/);
    expect(sql).toMatch(/furniture_level/);
    expect(sql).toMatch(/hs_plank_stairs/);
    expect(sql).toMatch(/Count in EACH/);
    expect(sql).not.toMatch(/create table public\.products/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).toMatch(/Does NOT enable accounting/);
  });

  it("wall tile is a warning, not invented labor", () => {
    const ctx = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
    });
    const w = knowledgeWarnings(ctx, { pickedLabels: ["Wall"] });
    expect(w.some((x) => x.id === "tile-wall")).toBe(true);
  });
});

describe("0195 captures pattern repeat and delivery without inventing a cut plan", () => {
  it("adds pattern_repeat and delivery_scope as notes", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0195_flooring_knowledge_pattern_delivery.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0195_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/pattern_repeat/);
    expect(sql).toMatch(/delivery_scope/);
    expect(sql).toMatch(/does not generate a cut plan|not a cut plan/i);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).toMatch(/Does NOT enable accounting/);
    expect(knowledgeQuestionByKey("pattern_repeat")?.purpose).toBe("WAREHOUSE");
    expect(knowledgeQuestionByKey("delivery_scope")?.purpose).toBe("PURCHASING");
  });
});

describe("stair extras and mixed-job measured area", () => {
  it("a stair step count is Yes for landings/open-sides; empty count is not", () => {
    expect(answerGateValues({ kind: "stairs", groups: [{ type: "Waterfall", count: "12" }] })).toEqual([
      "Yes",
      "Waterfall",
    ]);
    expect(answerGateValues({ kind: "stairs", groups: [{ type: "Waterfall", count: "" }] })).toEqual([]);
    expect(answerGateValues({ kind: "hs_stairs", steps: "8" })).toEqual(["Yes"]);
    expect(answerGateValues({ kind: "hs_stairs", steps: "0" })).toEqual([]);
    expect(answerGateValues({ kind: "number", value: "2" })).toEqual(["2"]);
  });

  it("copies carpet_stairs Yes onto the stairs key the extras still read", () => {
    expect(synthesizeStairGate({ carpet_stairs: ["Yes"] }).stairs).toEqual(["Yes"]);
    expect(synthesizeStairGate({ carpet_install: ["Stretch-in"] }).stairs).toBeUndefined();
  });

  it("mixed floor-map rooms keep their own measured sq ft per product", () => {
    const by = groupMeasuredSqftByLabel([
      { label: "Mohawk carpet", measuredSqft: 300 },
      { label: "LVP click", measuredSqft: 200 },
      { label: "Mohawk carpet", measuredSqft: 50 },
    ]);
    expect(by["Mohawk carpet"]).toBe(350);
    expect(by["LVP click"]).toBe(200);
    const carpet = computeMaterialTakeoff({ family: "carpet", measuredSqft: by["Mohawk carpet"], cutsSqft: 432 });
    const lvp = computeMaterialTakeoff({ family: "lvp", measuredSqft: by["LVP click"], wastePct: 10 });
    expect(carpet.measured.sqft).toBe(350);
    expect(lvp.measured.sqft).toBe(200);
    expect(lvp.orderSqft).toBe(220);
    expect(carpet.measured.sqft).not.toBe(lvp.measured.sqft);
  });

  it("0196 re-gates stair extras and floating underlayment without inventing prices", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0196_flooring_knowledge_stair_gates.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0196_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/carpet_stairs/);
    expect(sql).toMatch(/hs_plank_stairs/);
    expect(sql).toMatch(/hs_underlayment/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).toMatch(/Does NOT enable accounting/);
    expect(knowledgeQuestionByKey("stair_landings")?.quantityUnit).toBe("each");
    expect(knowledgeQuestionByKey("stair_landings")?.require).toEqual({ key: "stairs", in: ["Yes"] });
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/answerGateValues/);
    expect(q).toMatch(/groupMeasuredSqftByLabel/);
  });
});

describe("0197 scope notes and delivery charge", () => {
  it("adds asbestos and plank direction without inventing prices", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0197_flooring_knowledge_scope_notes.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0197_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/asbestos_risk/);
    expect(sql).toMatch(/hs_direction/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).toMatch(/Does NOT enable accounting/);
    expect(sql).not.toMatch(/create table public\.products/);
    expect(knowledgeQuestionByKey("hs_direction")?.families).toEqual(["lvp", "laminate", "hardwood"]);
    expect(knowledgeQuestionByKey("asbestos_risk")?.purpose).toBe("WARNING");
  });

  it("emits Delivery only when Settings already has a positive cost", () => {
    expect(deliveryAddonCost(["Include delivery"], 75)).toBe(75);
    expect(deliveryAddonCost(["Include delivery"], 0)).toBeNull();
    expect(deliveryAddonCost(["Include delivery"], null)).toBeNull();
    expect(deliveryAddonCost(["Customer pickup / will call"], 75)).toBeNull();
    expect(deliveryAddonCost(["Field verify / TBD"], 75)).toBeNull();
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/deliveryAddonCost/);
  });

  it("warns on possible asbestos without inventing abatement dollars", () => {
    const ctx = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
      hs_demo: ["Sheet vinyl"],
    });
    const w = knowledgeWarnings(ctx, { pickedLabels: ["Possible — test before removal"] });
    expect(w.some((x) => x.id === "asbestos")).toBe(true);
  });
});

describe("vapor_barrier overlay matches SQL any (floating/glue OR concrete)", () => {
  it("nail-down hardwood over concrete still asks; plywood does not", () => {
    const nailConcrete = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Hardwood"],
      install_method: ["Nail-down"],
      substrate: ["Concrete"],
    });
    expect(nailConcrete).toContain("vapor_barrier");
    expect(nailConcrete).toContain("hardwood_fasteners");

    const nailPlywood = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Hardwood"],
      install_method: ["Nail-down"],
      substrate: ["Plywood / OSB"],
    });
    expect(nailPlywood).not.toContain("vapor_barrier");

    const floating = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(floating).toContain("vapor_barrier");

    const stretch = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(stretch).not.toContain("vapor_barrier");
  });

  it("SQL walk: nail + concrete shows vapor_barrier; nail + plywood hides it", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0198_flooring_knowledge_vapor_barrier.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0198_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/vapor_barrier/);
    expect(sql).toMatch(/substrate/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).toMatch(/Does NOT enable accounting/);
    expect(knowledgeQuestionByKey("vapor_barrier")?.any).toEqual([
      { systems: ["floating", "glue"] },
      { substrate: ["Concrete"] },
    ]);
  });
});

describe("salesperson review buckets by purpose, not a level regex", () => {
  it("furniture_level is Specials, never Prep", () => {
    expect(reviewBucketForQuestion({ key: "furniture_level", label: "Furniture moving" })).toBe(
      "specials",
    );
    expect(reviewBucketForQuestion({ key: "selflevel_needed", label: "Self-leveler" })).toBe("prep");
    expect(reviewBucketForQuestion({ key: "vapor_barrier", label: "Moisture barrier" })).toBe("prep");
  });

  it("layout notes sit under Installation, not Special conditions", () => {
    expect(reviewBucketForQuestion({ key: "tile_layout", label: "Tile layout" })).toBe("installation");
    expect(reviewBucketForQuestion({ key: "pattern_match", label: "Pattern match" })).toBe(
      "installation",
    );
    expect(reviewBucketForQuestion({ key: "hs_direction", label: "Plank run direction" })).toBe(
      "installation",
    );
    expect(reviewBucketForQuestion({ key: "vinyl_layout", label: "Sheet vinyl layout" })).toBe(
      "installation",
    );
  });

  it("removal / accessories / stairs land in the right columns", () => {
    expect(reviewBucketForQuestion({ key: "hs_demo", label: "Existing flooring" })).toBe("removal");
    expect(reviewBucketForQuestion({ key: "asbestos_risk", label: "Asbestos" })).toBe("removal");
    expect(reviewBucketForQuestion({ key: "tack_strip", label: "Tack strip" })).toBe("accessories");
    expect(reviewBucketForQuestion({ key: "carpet_stairs", label: "Carpet stairs" })).toBe(
      "installation",
    );
  });

  it("extra-pad area uses measured-vs-equivalent wording, not a bare sqyd conversion", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).not.toMatch(/wantYd \? numv\(ex\.sqft\) \/ 9/);
    expect(q).toMatch(/formatMeasuredLabel/);
    expect(
      formatMeasuredLabel({ sqft: 270, sqydEquivalent: 30 }, { showEquivalentYd: true }),
    ).toMatch(/equivalent area — not an order quantity/);
  });
});

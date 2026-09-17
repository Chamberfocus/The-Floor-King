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
  applyHardSurfaceStairTrimFill,
  answersHaveTrimType,
  trimLabelsFromPicks,
  applyTrimTypeSeed,
  HS_TRANSITION_OPTION_TO_TRIM,
  HS_BASE_OPTION_TO_TRIM,
  annotateRemovalDescription,
  billsBySqydFamily,
  cartonTakeoff,
  catalogCategoryForFamily,
  coerceTrimUnit,
  computeMaterialTakeoff,
  cutWidthChoicesFt,
  defaultCutWidthFt,
  equivalentSqyd,
  formatTakeoffStrip,
  formatEquivalentSqyd,
  familyFromCatalogCategory,
  familyFromSurfaceLabel,
  hardwoodConstructionFromLabel,
  hardwoodConstructionFromSpecies,
  installContextFromValByKey,
  withProductFamilies,
  flooringFamiliesFromCategories,
  unscopedProductFamilies,
  installMethodOptionsFor,
  permittedInstallSystems,
  installSystemFromLabel,
  matchesShowIf,
  hardSurfaceInstallMethodOptions,
  solePermittedInstallSystem,
  synthesizeSoleInstallMethod,
  questionApplies,
  sqydToSqft,
  visibleKnowledgeKeys,
  resolveQuestionVisibility,
  knowledgeQuestionByKey,
  amountUnitLabelForQuestion,
  knowledgeWarnings,
  knowledgeWhenApplies,
  jobNeedsAcclimationClimate,
  KNOWLEDGE_QUESTIONS,
  sortEstimateQuestions,
  estimatorPhaseForQuestion,
  estimatorPhaseLabel,
  showIfReferencedKeys,
  prepQuantitiesAreFinal,
  prepQuantitySuffix,
  answerGateValues,
  coerceYesNoChoiceAnswer,
  synthesizeStairGate,
  stairStepCountFromAnswers,
  jobNeedsHardSurfaceStairTrim,
  HARD_SURFACE_STAIR_TRIM_LABELS,
  groupMeasuredSqftByLabel,
  deliveryAddonCost,
  reviewBucketForQuestion,
  formatMeasuredLabel,
  materialWastePctForEmit,
  rollGoodsHaveCuts,
  areaDerivedMaterialAllowed,
  areaDerivedMaterialQty,
  measuredInstallLaborAllowed,
  rollGoodsSeamWarnings,
  measuredRectsFromRooms,
  seamImplication,
  buildSalespersonReview,
  reviewToJobNotes,
  mergeReviewWarnings,
  emptyInstallContext,
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

  it("flags floor-map products that the job type / surface did not scope", () => {
    expect(flooringFamiliesFromCategories(["carpet", "lvp", "trim", "labor"])).toEqual(["carpet", "lvp"]);
    const lvpOnly = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Floating / click"],
    });
    expect(unscopedProductFamilies(lvpOnly, ["hardwood"])).toEqual(["hardwood"]);
    expect(unscopedProductFamilies(lvpOnly, ["lvp"])).toEqual([]);
    const mixedType = installContextFromValByKey({
      project_type: ["Carpet", "Hard surface"],
      surface_type: ["LVP / LVT"],
    });
    expect(unscopedProductFamilies(mixedType, ["carpet", "lvp"])).toEqual([]);
    const pending = installContextFromValByKey({
      project_type: ["Hard surface"],
    });
    expect(pending.surfacePending).toBe(true);
    expect(unscopedProductFamilies(pending, ["hardwood"])).toEqual([]);

    const merged = withProductFamilies(lvpOnly, ["hardwood", "lvp"]);
    expect(merged.families).toEqual(["lvp", "hardwood"]);
    expect(merged.unscopedProductFamilies).toEqual(["hardwood"]);
    expect(knowledgeWarnings(merged).some((w) => w.id === "unscoped-products")).toBe(true);
    expect(knowledgeWarnings(lvpOnly).some((w) => w.id === "unscoped-products")).toBe(false);
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/withProductFamilies/);
    expect(q).toMatch(/hardSurfaceInstallMethodOptions/);
    expect(q).not.toMatch(/installMethodOptionsForFamilies\(flooringCtx/);

    const lam = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
    });
    expect(lam.systems).toEqual(["floating"]);
    expect(lam.installPending).toBe(false);
    const lamPlusVinyl = withProductFamilies(lam, ["vinyl"]);
    expect(lamPlusVinyl.families.sort()).toEqual(["laminate", "vinyl"]);
    expect(lamPlusVinyl.systems).toEqual([]);
    expect(lamPlusVinyl.installPending).toBe(true);
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

  it("hard-surface install chips never include carpet stretch-in or carpet tile", () => {
    const mixed = hardSurfaceInstallMethodOptions(["carpet", "lvp"]);
    expect(mixed.map((o) => o.label)).toEqual(["Floating / click", "Glue-down", "Loose-lay"]);
    expect(mixed.some((o) => /stretch|carpet tile/i.test(o.label))).toBe(false);

    const pendingHs = hardSurfaceInstallMethodOptions(["carpet"]);
    expect(pendingHs.map((o) => o.system)).toEqual(
      expect.arrayContaining(["floating", "glue", "nail", "thinset", "loose_lay"]),
    );
    expect(pendingHs.some((o) => o.system === "stretch_in" || o.system === "carpet_tile")).toBe(false);
  });

  it("infers the only legal method for laminate, tile, and sheet vinyl — not LVP", () => {
    expect(solePermittedInstallSystem(["laminate"])).toBe("floating");
    expect(solePermittedInstallSystem(["tile"])).toBe("thinset");
    expect(solePermittedInstallSystem(["vinyl"])).toBe("glue");
    expect(solePermittedInstallSystem(["lvp"])).toBeNull();
    expect(solePermittedInstallSystem(["hardwood"], "engineered")).toBeNull();
    expect(solePermittedInstallSystem(["laminate", "vinyl"])).toBeNull();
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

  it("labels sq ft ÷ 9 as equivalent area, not an order", () => {
    expect(formatEquivalentSqyd(450)).toBe("50 sq yd equivalent area — not an order qty");
    expect(formatEquivalentSqyd(9)).toBe("1 sq yd equivalent area — not an order qty");
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

  it("never writes taped roll-goods area onto a Builder material quantity", () => {
    expect(areaDerivedMaterialAllowed("carpet")).toBe(false);
    expect(areaDerivedMaterialAllowed("vinyl")).toBe(false);
    expect(areaDerivedMaterialAllowed("lvp")).toBe(true);
    expect(areaDerivedMaterialAllowed("hardwood")).toBe(true);
    expect(areaDerivedMaterialAllowed("laminate")).toBe(true);
    expect(areaDerivedMaterialAllowed("tile")).toBe(true);
    expect(areaDerivedMaterialAllowed("other")).toBe(true);
    // 450 sq ft = 50 sq yd equivalent — that conversion is not an order.
    expect(
      areaDerivedMaterialQty({ family: "carpet", measuredSqft: 450, billingUnit: "sqyd" }),
    ).toBeNull();
    expect(
      areaDerivedMaterialQty({ family: "vinyl", measuredSqft: 180, billingUnit: "sqyd" }),
    ).toBeNull();
    expect(
      areaDerivedMaterialQty({ family: "lvp", measuredSqft: 500, billingUnit: "sqft" }),
    ).toBe(500);
    expect(
      areaDerivedMaterialQty({ family: "hardwood", measuredSqft: 500, billingUnit: "sqft" }),
    ).toBe(500);
    // Install labor still follows measured area until cuts own the job.
    expect(measuredInstallLaborAllowed("carpet", 0)).toBe(true);
    expect(measuredInstallLaborAllowed("carpet", undefined)).toBe(true);
    expect(measuredInstallLaborAllowed("carpet", 540)).toBe(false);
    expect(measuredInstallLaborAllowed("vinyl", 90)).toBe(false);
    expect(measuredInstallLaborAllowed("lvp", 0)).toBe(true);
    expect(measuredInstallLaborAllowed("lvp", 999)).toBe(true);
  });

  it("AI notes estimate does not order roll goods from taped sq ft ÷ 9", () => {
    const src = readFileSync(join(root, "src/app/(app)/estimates/ai-actions.ts"), "utf8");
    expect(src).toMatch(/areaDerivedMaterialAllowed/);
    expect(src).toMatch(/enter cuts — not sq ft ÷ 9/);
    expect(src).not.toMatch(/Math\.ceil\(\(sqft \/ 9\) \* \(1 \+ profile\.waste/);
    expect(src).toMatch(/length_in: null/);
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

describe("roll-goods seam implications are not a cut plan", () => {
  it("does not invent a seam from a missing catalog roll width", () => {
    expect(seamImplication({ name: "Dining", lengthFt: 14, widthFt: 16 }, null)).toBeNull();
    expect(
      rollGoodsSeamWarnings({
        family: "carpet",
        rooms: [{ name: "Dining", lengthFt: 14, widthFt: 16 }],
      }),
    ).toEqual([]);
  });

  it("flags a seam when both room dimensions exceed the catalog roll width", () => {
    expect(seamImplication({ name: "Dining", lengthFt: 14, widthFt: 16 }, 12)).toBe("must_seam");
    const w = rollGoodsSeamWarnings({
      family: "carpet",
      rollWidthFt: 12,
      rooms: [{ name: "Dining", lengthFt: 14, widthFt: 16 }],
    });
    expect(w).toHaveLength(1);
    expect(w[0].id).toBe("carpet-must-seam");
    expect(w[0].text).toMatch(/12' carpet roll/);
    expect(w[0].text).toMatch(/Dining \(14' × 16'\)/);
    expect(w[0].text).toMatch(/Enter cuts — this is not a cut plan/);
    expect(w[0].text).not.toMatch(/order 50/);
  });

  it("flags direction when the room fits one way on the roll", () => {
    expect(seamImplication({ name: "Living", lengthFt: 12, widthFt: 16 }, 12)).toBe("direction_matters");
    const w = rollGoodsSeamWarnings({
      family: "vinyl",
      rollWidthFt: 12,
      rooms: [{ name: "Living", lengthFt: 12, widthFt: 16 }],
    });
    expect(w[0].id).toBe("vinyl-direction");
    expect(w[0].text).toMatch(/confirm direction/);
    expect(w[0].text).toMatch(/Living \(12' × 16'\)/);
  });

  it("is silent when the room fits the roll, and silent once cuts exist", () => {
    expect(seamImplication({ name: "Office", lengthFt: 10, widthFt: 11 }, 12)).toBe("fits");
    expect(
      rollGoodsSeamWarnings({
        family: "carpet",
        rollWidthFt: 12,
        rooms: [{ name: "Office", lengthFt: 10, widthFt: 11 }],
      }),
    ).toEqual([]);
    expect(
      rollGoodsSeamWarnings({
        family: "carpet",
        rollWidthFt: 12,
        hasCuts: true,
        rooms: [{ name: "Dining", lengthFt: 14, widthFt: 16 }],
      }),
    ).toEqual([]);
  });

  it("does not pick a width when catalog products disagree", () => {
    const w = rollGoodsSeamWarnings({
      family: "carpet",
      catalogWidthsFt: [12, 15],
      rooms: [{ name: "Dining", lengthFt: 14, widthFt: 16 }],
    });
    expect(w).toHaveLength(1);
    expect(w[0].id).toBe("carpet-roll-widths");
    expect(w[0].text).toMatch(/12' and 15'/);
    expect(w[0].text).not.toMatch(/seam is required/);
  });

  it("includes closets as their own rectangles and mentions pattern match", () => {
    const rooms = measuredRectsFromRooms([
      {
        name: "Living",
        lengthFt: 14,
        widthFt: 16,
        sections: [{ name: "Closet", lengthFt: 3, widthFt: 5 }],
      },
    ]);
    expect(rooms).toEqual([
      { name: "Living", lengthFt: 14, widthFt: 16 },
      { name: "Living / Closet", lengthFt: 3, widthFt: 5 },
    ]);
    const w = rollGoodsSeamWarnings({
      family: "carpet",
      rollWidthFt: 12,
      patternMatch: true,
      rooms,
    });
    expect(w.some((x) => x.id === "carpet-must-seam" && /Pattern matching/.test(x.text))).toBe(true);
    expect(w.some((x) => x.id === "carpet-must-seam" && /Closet/.test(x.text))).toBe(false);
  });

  it("skips irregular sq ft overrides that have no L×W", () => {
    expect(
      measuredRectsFromRooms([{ name: "Odd", lengthFt: 0, widthFt: 0, sqftOverride: 220 }]),
    ).toEqual([]);
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

  it("acclimation is hardwood OR glue-down; moisture_test also follows a moisture-concern flag", () => {
    const anyWhen = knowledgeQuestionByKey("acclimation")?.any;
    expect(anyWhen).toEqual([{ families: ["hardwood"] }, { systems: ["glue"] }]);
    expect(knowledgeQuestionByKey("moisture_test")?.any).toEqual([
      { families: ["hardwood"] },
      { systems: ["glue"] },
      { subfloor: ["Moisture concerns"] },
    ]);

    const pending = installContextFromValByKey({ project_type: ["Hard surface"] });
    expect(knowledgeWhenApplies({ any: anyWhen }, pending)).toBe(true);

    const lam = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    expect(knowledgeWhenApplies({ any: anyWhen }, lam)).toBe(false);
    expect(knowledgeWhenApplies(knowledgeQuestionByKey("moisture_test")!, lam)).toBe(false);

    const lamMoisture = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
      subfloor_condition: ["Moisture concerns"],
    });
    expect(knowledgeWhenApplies(knowledgeQuestionByKey("moisture_test")!, lamMoisture)).toBe(true);
    expect(knowledgeWhenApplies({ any: anyWhen }, lamMoisture)).toBe(false);

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

    const carpetGlue = installContextFromValByKey({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(knowledgeWhenApplies({ any: anyWhen }, carpetGlue)).toBe(true);
    expect(jobNeedsAcclimationClimate({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    })).toBe(true);
    expect(jobNeedsAcclimationClimate({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    })).toBe(false);
    expect(jobNeedsAcclimationClimate({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    })).toBe(false);
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
    expect(accessoryUnitForType("Stair nose")).toBe("each");
    expect(accessoryUnitForType("Stair tread")).toBe("each");
    expect(accessoryUnitForType("Stair riser")).toBe("each");
    expect(accessoryUnitForType("Vent / register")).toBe("each");
    expect(coerceTrimUnit("Stair nose", "sqft")).toBe("each");
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
    expect(has(keys, "moisture_mitigation")).toBe(false);
  });

  it("laminate / tile / sheet vinyl do not wait for a click on their only legal method", () => {
    const lam = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
    });
    expect(has(lam, "adhesive")).toBe(false);
    expect(has(lam, "laminate_expansion")).toBe(true);
    expect(has(lam, "attached_pad")).toBe(true);
    expect(has(lam, "hardwood_fasteners")).toBe(false);

    const tile = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
    });
    expect(has(tile, "adhesive")).toBe(false);
    expect(has(tile, "tile_setting")).toBe(true);
    expect(has(tile, "attached_pad")).toBe(false);

    const vinyl = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
    });
    expect(has(vinyl, "adhesive")).toBe(true);
    expect(has(vinyl, "vinyl_layout")).toBe(true);
    expect(has(vinyl, "attached_pad")).toBe(false);
    expect(has(vinyl, "moisture_test")).toBe(true);

    const lvp = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
    });
    expect(has(lvp, "adhesive")).toBe(true);
    expect(has(lvp, "attached_pad")).toBe(true);
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
    expect(has(keys, "moisture_mitigation")).toBe(true);
  });

  it("each family asks its own follow-ups and hides the others", () => {
    const on = (keys: string[], want: string[]) => want.forEach((k) => expect(keys, k).toContain(k));
    const off = (keys: string[], hide: string[]) => hide.forEach((k) => expect(keys, k).not.toContain(k));

    const carpetStretch = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    on(carpetStretch, ["carpet_install", "pattern_match", "tack_strip", "carpet_pad", "existing_pad", "hs_demo", "substrate", "radiant_heat"]);
    off(carpetStretch, ["adhesive", "attached_pad", "tile_setting", "vinyl_layout", "hardwood_fasteners", "laminate_expansion", "acclimation", "moisture_test", "hs_direction"]);

    const carpetGlue = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    on(carpetGlue, ["adhesive", "vapor_barrier"]);
    off(carpetGlue, ["tack_strip", "carpet_pad", "attached_pad", "tile_layout"]);

    const carpetTile = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Carpet tile"],
    });
    on(carpetTile, ["adhesive"]);
    off(carpetTile, ["tack_strip", "carpet_pad", "laminate_expansion"]);

    const lam = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      install_method: ["Floating / click"],
    });
    on(lam, ["attached_pad", "laminate_expansion", "hs_direction"]);
    off(lam, ["adhesive", "hardwood_fasteners", "tile_setting", "vinyl_layout", "tack_strip", "acclimation", "moisture_test", "moisture_mitigation"]);

    const lvpGlue = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Glue-down"],
    });
    on(lvpGlue, ["adhesive", "acclimation", "moisture_test", "moisture_mitigation"]);
    off(lvpGlue, ["attached_pad", "laminate_expansion", "hardwood_fasteners", "tile_setting"]);

    const engNail = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Engineered hardwood"],
      install_method: ["Nail-down"],
    });
    on(engNail, ["hardwood_fasteners", "acclimation", "moisture_test", "moisture_mitigation"]);
    off(engNail, ["adhesive", "attached_pad", "tile_setting", "vinyl_layout"]);

    const vinyl = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Sheet vinyl"],
      install_method: ["Glue-down"],
    });
    on(vinyl, ["vinyl_layout", "vinyl_skim", "adhesive", "moisture_test", "moisture_mitigation"]);
    off(vinyl, ["attached_pad", "carpet_pad", "tile_application", "hardwood_fasteners"]);

    const tile = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      install_method: ["Thinset / mortar"],
    });
    on(tile, ["tile_application", "tile_body", "tile_format", "tile_layout", "tile_setting"]);
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
    expect(has(keys, "hs_prep")).toBe(true);
    expect(has(keys, "subfloor_needed")).toBe(true);
    expect(has(keys, "selflevel_needed")).toBe(true); // unanswered hs_prep does not hide
    expect(has(keys, "tile_setting")).toBe(false);
    expect(
      has(
        visibleKnowledgeKeys({
          project_type: ["Carpet"],
          carpet_install: ["Stretch-in"],
          hs_prep: ["None"],
        }),
        "selflevel_needed",
      ),
    ).toBe(false);
    expect(
      has(
        visibleKnowledgeKeys({
          project_type: ["Carpet"],
          carpet_install: ["Stretch-in"],
          hs_prep: ["Self-leveling"],
        }),
        "selflevel_needed",
      ),
    ).toBe(true);
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
    expect(has(keys, "tile_body")).toBe(true);
    expect(has(keys, "tile_format")).toBe(true);
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

  it("0200 asks moisture_test from substrate moisture concerns without inventing a reading", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0200_flooring_knowledge_prep_gates.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0200_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/Moisture concerns/);
    expect(sql).toMatch(/subfloor/);
    expect(sql).not.toMatch(/create table public\.products/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);

    const lam = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
    });
    expect(has(lam, "moisture_test")).toBe(false);

    const flagged = visibleKnowledgeKeys({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      subfloor_condition: ["Moisture concerns"],
    });
    expect(has(flagged, "moisture_test")).toBe(true);
    expect(has(flagged, "moisture_mitigation")).toBe(true);
    expect(has(lam, "moisture_mitigation")).toBe(false);

    const uneven = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      subfloor_condition: ["Uneven"],
      hs_prep: ["None"],
    });
    expect(knowledgeWarnings(uneven).some((w) => w.id === "subfloor-uneven")).toBe(true);
    expect(
      knowledgeWarnings(
        installContextFromValByKey({
          project_type: ["Hard surface"],
          surface_type: ["LVP / LVT"],
          subfloor_condition: ["Uneven"],
          hs_prep: ["Self-leveling"],
        }),
      ).some((w) => w.id === "subfloor-uneven"),
    ).toBe(false);
    expect(
      knowledgeWarnings(
        installContextFromValByKey({
          project_type: ["Hard surface"],
          subfloor_condition: ["Damage / soft spots"],
          subfloor_needed: ["No"],
        }),
      ).some((w) => w.id === "subfloor-damage"),
    ).toBe(true);
    expect(
      knowledgeWarnings(
        installContextFromValByKey({
          project_type: ["Carpet"],
          subfloor_condition: ["Damage / soft spots"],
          subfloor_needed: ["Field verify / TBD"],
        }),
      ).some((w) => w.id === "subfloor-damage"),
    ).toBe(false);
    expect(
      knowledgeWarnings(
        installContextFromValByKey({
          project_type: ["Hard surface"],
          subfloor_condition: ["Unknown / field verify"],
          prep_confidence: ["Known"],
        }),
      ).some((w) => w.id === "subfloor-unknown-known"),
    ).toBe(true);
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
    expect(knowledgeQuestionByKey("selflevel_needed")?.require).toEqual({
      key: "hs_prep",
      in: ["Self-leveling"],
    });
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
          { key: "carpet_install", in: ["Glue-down", "Carpet tile"] },
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
          { key: "carpet_install", in: ["Glue-down"] },
        ],
      },
    },
    {
      key: "moisture_test",
      position: 235,
      show_if: {
        any: [
          { key: "install_method", in: ["Glue-down"] },
          { key: "carpet_install", in: ["Glue-down"] },
          { key: "surface_type", in: ["Hardwood", "Engineered hardwood"] },
          { key: "subfloor_condition", in: ["Moisture concerns"] },
        ],
      },
    },
    {
      key: "moisture_mitigation",
      position: 245,
      show_if: {
        any: [
          { key: "install_method", in: ["Glue-down"] },
          { key: "carpet_install", in: ["Glue-down"] },
          { key: "surface_type", in: ["Hardwood", "Engineered hardwood"] },
          { key: "subfloor_condition", in: ["Moisture concerns"] },
        ],
      },
    },
    { key: "vinyl_layout", position: 216, show_if: { key: "surface_type", in: ["Sheet vinyl"] } },
    { key: "vinyl_skim", position: 353, show_if: { key: "surface_type", in: ["Sheet vinyl"] } },
    { key: "tile_application", position: 217, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "tile_body", position: 218, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "tile_format", position: 219, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "tile_layout", position: 220, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "tile_setting", position: 221, show_if: { key: "surface_type", in: ["Tile"] } },
    { key: "subfloor_condition", position: 352, show_if: { key: "project_type", in: ["Carpet", "Hard surface"] } },
    { key: "existing_pad", position: 108, show_if: { key: "project_type", in: ["Carpet"] } },
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
      show_if: { key: "project_type", in: ["Carpet", "Hard surface"] },
    },
    {
      key: "demo_disposal",
      position: 275,
      show_if: {
        key: "hs_demo",
        in: [
          "Carpet",
          "Ceramic WITH mortar bed",
          "Ceramic WITHOUT mortar bed",
          "Sheet vinyl",
          "Luan",
          "LVP",
          "Laminate",
          "Glue-down hardwood",
          "Nailed hardwood",
          "Other",
        ],
      },
    },
    {
      key: "substrate",
      position: 350,
      show_if: { key: "project_type", in: ["Carpet", "Hard surface"] },
    },
    {
      key: "vapor_barrier",
      position: 207,
      show_if: {
        any: [
          { key: "install_method", in: ["Floating / click", "Glue-down"] },
          { key: "carpet_install", in: ["Glue-down"] },
          { key: "substrate", in: ["Concrete"] },
        ],
      },
    },
    {
      key: "radiant_heat",
      position: 208,
      show_if: { key: "project_type", in: ["Carpet", "Hard surface"] },
    },
    {
      key: "construction_grade",
      position: 209,
      show_if: {
        any: [
          { key: "project_type", in: ["Hard surface"] },
          { key: "carpet_install", in: ["Glue-down", "Carpet tile"] },
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
    {
      key: "hs_transitions",
      position: 291,
      show_if: { key: "project_type", in: ["Hard surface"] },
    },
    {
      key: "hs_base_trim",
      position: 292,
      show_if: { key: "project_type", in: ["Hard surface"] },
    },
    {
      key: "prep_scope",
      position: 300,
      show_if: { key: "project_type", in: ["Carpet", "Hard surface"] },
    },
    {
      key: "hs_prep",
      position: 310,
      show_if: { key: "project_type", in: ["Carpet", "Hard surface"] },
    },
    {
      key: "selflevel_needed",
      position: 320,
      show_if: { key: "hs_prep", in: ["Self-leveling"] },
    },
    {
      key: "subfloor_needed",
      position: 340,
      show_if: { key: "project_type", in: ["Carpet", "Hard surface"] },
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
    expect(keys).toContain("hs_transitions");
    expect(keys).toContain("hs_base_trim");
    expect(keys).not.toContain("adhesive");
    expect(keys).not.toContain("hardwood_fasteners");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("tile_setting");
    expect(keys).not.toContain("vinyl_layout");
    expect(keys).not.toContain("carpet_install");
    expect(keys).not.toContain("acclimation");
    expect(keys).not.toContain("moisture_test");
    expect(keys).not.toContain("moisture_mitigation");
  });

  it("laminate without clicking install_method still hides adhesive and shows floating follow-ups", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
    });
    expect(keys).toContain("attached_pad");
    expect(keys).toContain("laminate_expansion");
    expect(keys).not.toContain("adhesive");
    expect(keys).not.toContain("hardwood_fasteners");
    expect(synthesizeSoleInstallMethod({ project_type: ["Hard surface"], surface_type: ["Laminate"] }).install_method).toEqual([
      "Floating / click",
    ]);
  });

  it("laminate + moisture concerns still asks moisture_test (not a fake reading)", () => {
    const keys = walk({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
      subfloor_condition: ["Moisture concerns"],
    });
    expect(keys).toContain("moisture_test");
    expect(keys).toContain("moisture_mitigation");
    expect(keys).not.toContain("adhesive");
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
    expect(keys).toContain("moisture_mitigation");
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
    expect(keys).toContain("hs_demo");
    expect(keys).toContain("substrate");
    expect(keys).toContain("existing_pad");
    expect(keys).toContain("radiant_heat");
    expect(keys).toContain("hs_prep");
    expect(keys).toContain("subfloor_needed");
    expect(keys).toContain("prep_scope");
    expect(keys).not.toContain("selflevel_needed");
    expect(keys).not.toContain("pattern_repeat");
    expect(keys).not.toContain("adhesive");
    expect(keys).not.toContain("surface_type");
    expect(keys).not.toContain("hs_transitions");
    expect(keys).not.toContain("hs_base_trim");
    expect(keys).not.toContain("stair_landings");
    expect(keys).not.toContain("stair_open_sides");
    expect(keys).not.toContain("demo_disposal");
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
    expect(
      walk({
        project_type: ["Carpet"],
        carpet_install: ["Stretch-in"],
        substrate: ["Concrete"],
      }),
    ).toContain("vapor_barrier");
    expect(
      walk({
        project_type: ["Carpet"],
        carpet_install: ["Glue-down"],
      }),
    ).toContain("vapor_barrier");
  });

  it("glue-down carpet: overlay hides tack strip even though show_if is Carpet", () => {
    const keys = walk({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(keys).toContain("adhesive");
    expect(keys).toContain("vapor_barrier");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("carpet_pad");
  });

  it("carpet-only walk uses shared typed demo (0142/0201), not a second $0.50 tear-out", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0201_flooring_knowledge_shared_demo.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0201_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/789950c7-06a2-4c4b-81ca-15b5a4a54f29/);
    expect(sql).toMatch(/\["Carpet","Hard surface"\]/);
    expect(sql).toMatch(/demo_disposal/);
    expect(sql).toMatch(/vapor_barrier/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).not.toMatch(/create table public\.products/);
    expect(sql).toMatch(/retired the generic/);
    expect(sql).not.toMatch(/insert into public\.estimate_questions/);

    const beforeDemo = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(beforeDemo).toContain("hs_demo");
    expect(beforeDemo).toContain("substrate");
    expect(beforeDemo).not.toContain("demo_disposal");
    expect(beforeDemo).not.toContain("existing_bond");
    expect(beforeDemo).not.toContain("asbestos_risk");

    const afterCarpetDemo = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      hs_demo: ["Carpet"],
    });
    expect(afterCarpetDemo).toContain("demo_disposal");
    expect(afterCarpetDemo).not.toContain("asbestos_risk");
    expect(afterCarpetDemo).not.toContain("existing_bond");

    const overlay = visibleKnowledgeKeys({ project_type: ["Carpet"] });
    expect(overlay).toContain("hs_demo");
    expect(overlay).toContain("substrate");
    expect(overlay).toContain("demo_disposal");
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
    expect(keys.indexOf("tile_application")).toBeLessThan(keys.indexOf("tile_body")!);
    expect(keys.indexOf("tile_body")).toBeLessThan(keys.indexOf("tile_format")!);
    expect(keys.indexOf("tile_format")).toBeLessThan(keys.indexOf("tile_layout")!);
    expect(keys).toContain("tile_setting");
    expect(keys).not.toContain("attached_pad");
    expect(keys).not.toContain("vinyl_skim");
    expect(keys).not.toContain("hs_direction");
    expect(keys).not.toContain("asbestos_risk");
  });

  it("carpet tile asks adhesive, not pad or tack strip", () => {
    const keys = walk({
      project_type: ["Carpet"],
      carpet_install: ["Carpet tile"],
    });
    expect(keys).toContain("adhesive");
    expect(keys).not.toContain("tack_strip");
    expect(keys).not.toContain("carpet_pad");
    expect(keys).not.toContain("vapor_barrier");
  });

  it("0202 gates moisture mitigation and adds tile body without inventing a category", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0202_flooring_knowledge_tile_carpet_prep.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0202_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/moisture_mitigation/);
    expect(sql).toMatch(/tile_body/);
    expect(sql).toMatch(/Carpet tile/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).not.toMatch(/create table public\.products/);

    const ceramicNew = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["Tile"],
        install_method: ["Thinset / mortar"],
      }),
      { pickedLabels: ["Ceramic"] },
    );
    expect(ceramicNew.some((w) => w.id === "ceramic_substrate")).toBe(false);
    expect(ceramicNew.some((w) => w.id === "tile-stone")).toBe(false);

    const demoCeramic = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["Tile"],
        hs_demo: ["Ceramic WITHOUT mortar bed"],
      }),
    );
    expect(demoCeramic.some((w) => w.id === "ceramic_substrate")).toBe(true);

    const stone = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["Tile"],
      }),
      { pickedLabels: ["Natural stone"] },
    );
    expect(stone.some((w) => w.id === "tile-stone")).toBe(true);
    expect(knowledgeQuestionByKey("adhesive")?.systems).toEqual(["glue", "carpet_tile"]);
    expect(knowledgeQuestionByKey("tile_body")?.families).toEqual(["tile"]);
  });

  it("0203 asks radiant on carpet and tile format without inventing waste", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0203_flooring_knowledge_radiant_tile_format.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0203_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/radiant_heat/);
    expect(sql).toMatch(/tile_format/);
    expect(sql).toMatch(/\["Carpet","Hard surface"\]/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).not.toMatch(/create table public\.products/);

    const large = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["Tile"],
      }),
      { pickedLabels: ['Large format (24" or larger)'] },
    );
    expect(large.some((w) => w.id === "tile-large-format")).toBe(true);

    const mixedGlue = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["LVP / LVT", "Hardwood"],
        install_method: ["Glue-down"],
      }),
    );
    expect(mixedGlue.some((w) => w.id === "mixed-hs-install")).toBe(true);

    const mixedFloat = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["LVP / LVT", "Hardwood"],
        install_method: ["Floating / click"],
      }),
    );
    expect(mixedFloat.some((w) => w.id === "mixed-hs-method")).toBe(true);

    const unanswered = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Hard surface"],
        surface_type: ["LVP / LVT", "Hardwood"],
      }),
    );
    expect(unanswered.some((w) => w.id === "mixed-hs-install" || w.id === "mixed-hs-method")).toBe(false);

    const keys = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(keys).toContain("radiant_heat");
    expect(keys).not.toContain("tile_format");
    expect(
      walk({
        project_type: ["Hard surface"],
        surface_type: ["Tile"],
        install_method: ["Thinset / mortar"],
      }),
    ).toContain("tile_format");
  });

  it("0204 asks grade on glue-down carpet, not stretch-in, without inventing a ban", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0204_flooring_knowledge_grade_carpet.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0204_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/construction_grade/);
    expect(sql).toMatch(/Glue-down/);
    expect(sql).toMatch(/Carpet tile/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).not.toMatch(/create table public\.products/);

    expect(knowledgeQuestionByKey("construction_grade")?.any).toEqual([
      { families: ["hardwood", "lvp", "laminate", "vinyl", "tile"] },
      { systems: ["glue", "carpet_tile"] },
    ]);

    expect(
      walk({
        project_type: ["Carpet"],
        carpet_install: ["Stretch-in"],
      }),
    ).not.toContain("construction_grade");
    expect(
      walk({
        project_type: ["Carpet"],
        carpet_install: ["Glue-down"],
      }),
    ).toContain("construction_grade");
    expect(
      walk({
        project_type: ["Carpet"],
        carpet_install: ["Carpet tile"],
      }),
    ).toContain("construction_grade");
    expect(
      walk({
        project_type: ["Hard surface"],
        surface_type: ["Laminate"],
        install_method: ["Floating / click"],
      }),
    ).toContain("construction_grade");

    const below = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Carpet"],
        carpet_install: ["Glue-down"],
        construction_grade: ["Below grade"],
      }),
    );
    expect(below.some((w) => w.id === "carpet-glue-below-grade")).toBe(true);
    expect(below.some((w) => /do not assume a ban/i.test(w.text))).toBe(true);

    const stretchBelow = knowledgeWarnings(
      installContextFromValByKey({
        project_type: ["Carpet"],
        carpet_install: ["Stretch-in"],
        construction_grade: ["Below grade"],
      }),
    );
    expect(stretchBelow.some((w) => w.id === "carpet-glue-below-grade")).toBe(false);
  });

  it("0205 asks acclimation and moisture on glue-down carpet, not stretch-in", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0205_flooring_knowledge_carpet_glue_climate.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0205_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/acclimation/);
    expect(sql).toMatch(/moisture_test/);
    expect(sql).toMatch(/moisture_mitigation/);
    expect(sql).toMatch(/carpet_install/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).not.toMatch(/create table public\.products/);

    const stretch = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(stretch).not.toContain("acclimation");
    expect(stretch).not.toContain("moisture_test");
    expect(stretch).not.toContain("moisture_mitigation");

    const glue = walk({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(glue).toContain("acclimation");
    expect(glue).toContain("moisture_test");
    expect(glue).toContain("moisture_mitigation");
    expect(glue).toContain("adhesive");
    expect(glue).not.toContain("tack_strip");
  });

  it("0206 shares Floor prep and subfloor on carpet, bags only after Self-leveling", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0206_flooring_knowledge_shared_prep.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0206_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/subfloor_needed/);
    expect(sql).toMatch(/hs_prep/);
    expect(sql).toMatch(/selflevel_needed/);
    expect(sql).toMatch(/prep_scope/);
    expect(sql).toMatch(/Field verify \/ TBD/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).not.toMatch(/create table public\.products/);
    expect(sql).not.toMatch(/insert into public\.estimate_questions/);

    const stretch = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(stretch).toContain("hs_prep");
    expect(stretch).toContain("subfloor_needed");
    expect(stretch).toContain("prep_scope");
    expect(stretch).not.toContain("selflevel_needed");

    const selfLevel = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      hs_prep: ["Self-leveling"],
    });
    expect(selfLevel).toContain("selflevel_needed");
    expect(selfLevel.indexOf("hs_prep")).toBeLessThan(selfLevel.indexOf("selflevel_needed")!);

    const tbd = walk({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
      subfloor_needed: ["Field verify / TBD"],
    });
    expect(tbd).toContain("subfloor_needed");
    expect(tbd).toContain("hs_prep");

    const lam = walk({
      project_type: ["Hard surface"],
      surface_type: ["Laminate"],
    });
    expect(lam).toContain("hs_prep");
    expect(lam).toContain("subfloor_needed");
    expect(lam).not.toContain("selflevel_needed");
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
    expect(coerceYesNoChoiceAnswer("choice", { kind: "yesno", yes: true })).toEqual({
      kind: "choice",
      selected: ["Yes"],
    });
    expect(coerceYesNoChoiceAnswer("choice", { kind: "yesno", yes: false })).toEqual({
      kind: "choice",
      selected: ["No"],
    });
    expect(
      coerceYesNoChoiceAnswer("yesno", { kind: "choice", selected: ["Field verify / TBD"] }),
    ).toEqual({ kind: "choice", selected: ["Field verify / TBD"] });
    expect(coerceYesNoChoiceAnswer("yesno", { kind: "choice", selected: ["Yes"] })).toEqual({
      kind: "yesno",
      yes: true,
    });
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

  it("reads hard-surface step count separately from carpet waterfall", () => {
    const answers = {
      carpet: { kind: "stairs", groups: [{ type: "Waterfall", count: "12" }] },
      hs: { kind: "hs_stairs", steps: "8" },
      rooms: { kind: "number", value: "3" },
    };
    expect(stairStepCountFromAnswers(answers)).toBe(20);
    expect(stairStepCountFromAnswers(answers, ["hs_stairs"])).toBe(8);
    expect(stairStepCountFromAnswers(answers, ["stairs"])).toBe(12);
    expect(stairStepCountFromAnswers({ empty: { kind: "hs_stairs", steps: "" } })).toBe(0);
  });

  it("does not show HS stair-nose fill on carpet-only jobs", () => {
    expect(jobNeedsHardSurfaceStairTrim(["carpet"])).toBe(false);
    expect(jobNeedsHardSurfaceStairTrim(["lvp"])).toBe(true);
    expect(jobNeedsHardSurfaceStairTrim(["hardwood"])).toBe(true);
    expect(jobNeedsHardSurfaceStairTrim(["laminate"])).toBe(true);
    expect(jobNeedsHardSurfaceStairTrim(["vinyl"])).toBe(true);
    expect(jobNeedsHardSurfaceStairTrim(["tile"])).toBe(true);
    expect(jobNeedsHardSurfaceStairTrim(["carpet", "hardwood"])).toBe(true);
    expect(jobNeedsHardSurfaceStairTrim([])).toBe(false);
  });

  it("fills existing TRIM_TYPES treads, risers, and noses in EACH — no invented SKU", () => {
    expect([...HARD_SURFACE_STAIR_TRIM_LABELS]).toEqual(["Stair tread", "Stair riser", "Stair nose"]);
    const filled = applyHardSurfaceStairTrimFill(
      [{ type: "Stair tread", qty: "1" }],
      13,
      (label) => ({ type: label, qty: "" }),
    );
    expect(filled).toEqual([
      { type: "Stair tread", qty: "13" },
      { type: "Stair riser", qty: "13" },
      { type: "Stair nose", qty: "13" },
    ]);
    expect(applyHardSurfaceStairTrimFill([], 0, (label) => ({ type: label, qty: "" }))).toEqual([]);
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/applyHardSurfaceStairTrimFill/);
    expect(q).toMatch(/jobNeedsHardSurfaceStairTrim/);
    expect(q).toMatch(/stairStepCountFromAnswers\(jobAnswers, \["hs_stairs"\]\)/);
    expect(q).not.toMatch(/ensure\(\/tread\/i, "Stair tread"\)/);
  });

  it("warns when hard-surface stairs have no stair-nose trim, and stays quiet once one exists", () => {
    const ctx = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Floating / click"],
    });
    expect(
      knowledgeWarnings(ctx, { hsStairSteps: 13, hasStairNose: false }).some((x) => x.id === "hs-stair-nose"),
    ).toBe(true);
    expect(
      knowledgeWarnings(ctx, { hsStairSteps: 13, hasStairNose: true }).some((x) => x.id === "hs-stair-nose"),
    ).toBe(false);
    expect(
      knowledgeWarnings(ctx, { hsStairSteps: 0, hasStairNose: false }).some((x) => x.id === "hs-stair-nose"),
    ).toBe(false);
    const carpet = installContextFromValByKey({
      project_type: ["Carpet"],
      carpet_install: ["Stretch-in"],
    });
    expect(
      knowledgeWarnings(carpet, { hsStairSteps: 12, hasStairNose: false }).some((x) => x.id === "hs-stair-nose"),
    ).toBe(false);
    expect(
      answersHaveTrimType(
        { t: { kind: "trims", rows: [{ type: "Stair nose", qty: "13" }] } },
        /stair\s*nose/i,
      ),
    ).toBe(true);
    expect(answersHaveTrimType({ t: { kind: "trims", rows: [{ type: "Quarter round", qty: "40" }] } }, /stair\s*nose/i)).toBe(
      false,
    );
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/answersHaveTrimType\(answers, \/stair\\s\*nose\/i\)/);
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

    const carpetGlue = visibleKnowledgeKeys({
      project_type: ["Carpet"],
      carpet_install: ["Glue-down"],
    });
    expect(carpetGlue).toContain("vapor_barrier");
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
    expect(reviewBucketForQuestion({ key: "hs_transitions", label: "Doorway transitions" })).toBe(
      "accessories",
    );
    expect(reviewBucketForQuestion({ key: "hs_base_trim", label: "Base / QR" })).toBe("accessories");
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

describe("0199 hard-surface transitions and base trim without invented SKUs", () => {
  it("adds notes-only hs_transitions and hs_base_trim with correct units", () => {
    const sql = readFileSync(
      join(root, "supabase/migrations/0199_flooring_knowledge_hs_trim.sql"),
      "utf8",
    );
    expect(sql).toMatch(/P0_0199_FLOORING_KNOWLEDGE/);
    expect(sql).toMatch(/hs_transitions/);
    expect(sql).toMatch(/hs_base_trim/);
    expect(sql).toMatch(/Does NOT invent carton coverage/);
    expect(sql).toMatch(/Does NOT enable accounting/);
    expect(sql).not.toMatch(/"emit"/);
    expect(knowledgeQuestionByKey("hs_transitions")?.quantityUnit).toBe("each");
    expect(knowledgeQuestionByKey("hs_base_trim")?.quantityUnit).toBe("lnft");
    expect(knowledgeQuestionByKey("hs_transitions")?.families).toEqual([
      "lvp",
      "hardwood",
      "laminate",
      "vinyl",
      "tile",
    ]);
  });

  it("maps picks onto existing TRIM_TYPES and skips None / TBD", () => {
    expect(
      trimLabelsFromPicks(["T-mold", "Reducer", "Field verify / TBD"], HS_TRANSITION_OPTION_TO_TRIM),
    ).toEqual(["T-mold", "Reducer"]);
    expect(
      trimLabelsFromPicks(["None — keep existing / no new transitions", "Metal"], HS_TRANSITION_OPTION_TO_TRIM),
    ).toEqual(["Metal transition"]);
    expect(trimLabelsFromPicks(["Keep existing base", "Quarter round"], HS_BASE_OPTION_TO_TRIM)).toEqual([
      "Quarter round",
    ]);
    expect(accessoryUnitForType("T-mold")).toBe("each");
    expect(accessoryUnitForType("Quarter round")).toBe("lnft");
    const seeded = applyTrimTypeSeed([{ type: "T-mold", qty: "2" }], ["T-mold", "Reducer"], (label) => ({
      type: label,
      qty: "",
    }));
    expect(seeded).toEqual([
      { type: "T-mold", qty: "2" },
      { type: "Reducer", qty: "" },
    ]);
  });

  it("warns when picked transitions are missing from Trims, and stays quiet once added", () => {
    const ctx = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["LVP / LVT"],
      install_method: ["Floating / click"],
    });
    expect(
      knowledgeWarnings(ctx, {
        neededTransitionTrims: ["T-mold"],
        neededBaseTrims: ["Quarter round"],
        presentTrimTypes: [],
      })
        .map((w) => w.id)
        .sort(),
    ).toEqual(["hs-base-trim", "hs-transitions"]);
    expect(
      knowledgeWarnings(ctx, {
        neededTransitionTrims: ["T-mold"],
        neededBaseTrims: ["Quarter round"],
        presentTrimTypes: ["T-mold", "Quarter round"],
      }).some((w) => w.id === "hs-transitions" || w.id === "hs-base-trim"),
    ).toBe(false);
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/applyTrimTypeSeed/);
    expect(q).toMatch(/hsTransitionTrims/);
    expect(q).toMatch(/hsBaseTrims/);
  });
});

describe("removal descriptions distinguish glued vs floating without a second rate", () => {
  it("annotates LVP/laminate/vinyl tear-out with bond, carpet with pad, and leaves other lines alone", () => {
    expect(
      annotateRemovalDescription("Tear-out — LVP", { bond: ["Glued down"] }),
    ).toBe("Tear-out — LVP (glued down — not floating)");
    expect(
      annotateRemovalDescription("Tear-out — laminate", { bond: ["Floating / click — not glued"] }),
    ).toBe("Tear-out — laminate (floating / click — not glued)");
    expect(
      annotateRemovalDescription("Tear-out — carpet", { pad: ["Reuse (explicitly allowed)"] }),
    ).toBe("Tear-out — carpet (reuse existing pad (explicit))");
    expect(
      annotateRemovalDescription("Tear-out — carpet", { pad: ["Remove with old carpet"] }),
    ).toBe("Tear-out — carpet (pad removed with carpet)");
    expect(annotateRemovalDescription("Furniture moving (light)", { bond: ["Glued down"] })).toBe(
      "Furniture moving (light)",
    );
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/annotateRemovalDescription/);
  });
});

describe("salesperson review warnings are one source of truth for Builder notes", () => {
  it("reviewToJobNotes includes extraWarnings and does not invent a second Flags block", () => {
    const takeoff = computeMaterialTakeoff({
      family: "carpet",
      measuredSqft: 450,
    });
    const review = buildSalespersonReview({
      rooms: [],
      products: ["Berber sample — catalog name only"],
      takeoffs: [takeoff],
      ctx: emptyInstallContext(),
      removal: [],
      installation: [],
      prep: [],
      accessories: [],
      specials: ["Occupancy: Occupied"],
      extraWarnings: [
        {
          id: "carpet-no-cuts",
          text: "Carpet measured by area only — converting sq ft ÷ 9 is equivalent area, not a cut plan. Enter cuts (roll width × length) before ordering.",
        },
        { id: "radiant", text: "Radiant heat present — confirm the selected flooring is rated for radiant heat before ordering." },
      ],
    });
    expect(review.warnings.map((w) => w.id).sort()).toEqual(["carpet-no-cuts", "radiant"]);
    const notes = reviewToJobNotes(review);
    expect(notes).toMatch(/Warnings:/);
    expect(notes).toMatch(/Carpet measured by area only/);
    expect(notes).toMatch(/Radiant heat present/);
    expect(notes).toMatch(/Order quantity: TBD — enter cuts/);
    expect(notes).not.toMatch(/Flags to confirm/);
    // Takeoff's similar "no cut list" message must not duplicate the knowledge flag.
    expect(notes.match(/sq ft ÷ 9/g)?.length).toBeGreaterThanOrEqual(1);
    const warningBlock = notes.split("Warnings:")[1] ?? "";
    expect(warningBlock.match(/cut plan/gi)?.length).toBe(1);
    expect(notes).toMatch(/Occupancy: Occupied/);
    expect(notes.match(/Occupancy:/g)?.length).toBe(1);
    expect(notes).not.toMatch(/Conditions:/);
  });

  it("does not reprint occupancy or grade in Conditions when Review already listed them", () => {
    const review = buildSalespersonReview({
      rooms: [],
      products: [],
      takeoffs: [],
      ctx: {
        ...emptyInstallContext(),
        occupancy: ["Occupied"],
        grade: ["Above grade"],
      },
      removal: [],
      installation: ["Construction grade?: Above grade"],
      prep: [],
      accessories: [],
      specials: ["Occupancy: Occupied"],
    });
    expect(review.notes).toEqual([]);
    const notes = reviewToJobNotes(review);
    expect(notes.match(/Occupancy:/g)?.length).toBe(1);
    expect(notes).toMatch(/Construction grade\?: Above grade/);
    expect(notes).not.toMatch(/^Conditions:/m);
    expect(notes).not.toMatch(/• Grade:/);
  });

  it("keeps the takeoff order warning when the questionnaire did not already raise it", () => {
    const takeoff = computeMaterialTakeoff({ family: "vinyl", measuredSqft: 180 });
    const merged = mergeReviewWarnings([], [takeoff]);
    expect(merged.some((w) => w.id === "vinyl-no-layout")).toBe(true);
    expect(merged).toHaveLength(1);
  });

  it("does not resurrect a dismissed carpet-no-cuts flag from takeoff text", () => {
    const takeoff = computeMaterialTakeoff({ family: "carpet", measuredSqft: 450 });
    const merged = mergeReviewWarnings([], [takeoff], { suppressIds: ["carpet-no-cuts"] });
    expect(merged.some((w) => w.id === "carpet-no-cuts")).toBe(false);
    expect(merged).toEqual([]);
  });

  it("questionnaire feeds active flags into the review and drops the duplicate flagText join", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/extraWarnings:\s*warnings\.filter/);
    expect(q).toMatch(/suppressedWarningIds:\s*dismissed/);
    expect(q).not.toMatch(/Flags to confirm:/);
    expect(q).not.toMatch(/flagText/);
    expect(q).toMatch(/salespersonReview\.warnings\.map/);
  });
});

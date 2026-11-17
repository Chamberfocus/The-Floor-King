import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HS_STAIR_FLOOR_SQFT_TREAD,
  HS_STAIR_FLOOR_SQFT_WITH_RISER,
  areaPageCollectsLandings,
  areaPageCollectsStairAllowance,
  areaPageSquareFeet,
  computeMaterialTakeoff,
  foldFloorAdditionsIntoLines,
  hardSurfaceStairPiecesForPlan,
  hsStairMaterialOrder,
  hsStairPlanFromAnswers,
  hsStairReviewPhrase,
  hsStairRiserWantsWhiteBoard,
  installContextFromValByKey,
  landingJoinsQuestionCover,
  landingPieceSqft,
  landingReviewPhrase,
  landingTakeoffFromAnswer,
  stairPieceQuoteWhenMissing,
} from "@/lib/flooring-knowledge";
import { lineOrderQty, lineQty, lineTotal } from "@/lib/estimate-calc";

const root = process.cwd();

describe("hard-surface stair material allowance", () => {
  it("orders 8 sq ft per step with a riser and 4 sq ft without one", () => {
    expect(HS_STAIR_FLOOR_SQFT_WITH_RISER).toBe(8);
    expect(HS_STAIR_FLOOR_SQFT_TREAD).toBe(4);
    expect(hsStairMaterialOrder({ steps: 13, cover: "material", coverRiser: true })).toEqual({
      sqft: 104,
      perStep: 8,
      label: "tread + riser",
    });
    expect(hsStairMaterialOrder({ steps: 13, cover: "material", coverRiser: false })).toEqual({
      sqft: 52,
      perStep: 4,
      label: "tread only",
    });
    expect(hsStairMaterialOrder({ steps: 13, cover: "treads", coverRiser: true })).toBeNull();
    expect(hsStairMaterialOrder({ steps: 0, cover: "material", coverRiser: true })).toBeNull();
    expect(hsStairMaterialOrder({ steps: 13, cover: null, coverRiser: true })).toBeNull();
  });

  it("uses a white board only when the riser is not already covered by the floor", () => {
    expect(
      hsStairRiserWantsWhiteBoard({ cover: "treads", coverRiser: false, riserFinish: "white_board" }),
    ).toBe(true);
    expect(
      hsStairRiserWantsWhiteBoard({ cover: "material", coverRiser: false, riserFinish: "white_board" }),
    ).toBe(true);
    expect(
      hsStairRiserWantsWhiteBoard({ cover: "material", coverRiser: true, riserFinish: "white_board" }),
    ).toBe(false);
    expect(
      hsStairRiserWantsWhiteBoard({ cover: "treads", coverRiser: false, riserFinish: "leave" }),
    ).toBe(false);
    expect(hardSurfaceStairPiecesForPlan({ cover: "treads", coverRiser: false, riserFinish: "white_board" })).toEqual([
      "Stair tread",
      "White board",
      "Stair nose",
    ]);
    expect(hardSurfaceStairPiecesForPlan({ cover: "material", coverRiser: true, riserFinish: null })).toEqual([
      "Stair nose",
    ]);
    expect(hardSurfaceStairPiecesForPlan({ cover: null, coverRiser: true, riserFinish: null })).toBeNull();
  });

  it("keeps an unchosen cover off the square-foot order and prices the allowance without room waste", () => {
    const plan = hsStairPlanFromAnswers({
      rooms: { kind: "areas" },
      stairs: { kind: "hs_stairs", steps: "10", treadRiser: true },
    });
    expect(plan.cover).toBeNull();
    expect(plan.steps).toBe(10);
    expect(hsStairReviewPhrase(plan)).toBe("10 steps (tread + riser)");

    const chosen = hsStairPlanFromAnswers({
      stairs: {
        kind: "hs_stairs",
        steps: "10",
        treadRiser: false,
        cover: "material",
        riserFinish: "leave",
      },
    });
    expect(hsStairMaterialOrder(chosen)?.sqft).toBe(40);
    expect(hsStairReviewPhrase(chosen)).toMatch(/40 sq ft \(4 sq ft × 10, tread only\)/);
    expect(hsStairReviewPhrase(chosen)).toMatch(/included in the flooring total/);
    expect(hsStairReviewPhrase(chosen)).toMatch(/riser left as-is/);

    const allowance = lineOrderQty({
      line_type: "mat_labor",
      category: "lvp",
      unit: "sq ft",
      measure_unit: "sqft",
      sqft: 104,
      quantity: 104,
      waste_pct: 0,
      description: "Oak on stairs — 104 sq ft (13 steps × 8 sq ft, tread + riser)",
    });
    expect(allowance).toBe(104);
    expect(
      lineQty({
        line_type: "mat_labor",
        category: "hardwood",
        unit: "sqft",
        sqft: 104,
        quantity: null,
        description: "Oak wrap — wrap qty TBD (13 steps, tread + riser — not an automatic sq ft/step order)",
      }),
    ).toBe(0);

    expect(stairPieceQuoteWhenMissing(13, [], "Stair tread")).toEqual({
      description: "Stair tread",
      quantity: 13,
      unit: "each",
    });
    expect(stairPieceQuoteWhenMissing(13, [{ type: "White board" }], "White board")).toBeNull();

    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    expect(q).toMatch(/hsStairMaterialOrder/);
    expect(q).toMatch(/Flooring on the stairs/);
    expect(q).toMatch(/White board/);
    expect(q).toMatch(/wrap qty TBD/);
    expect(q).not.toMatch(/STAIR_SQFT_TREAD_RISER/);
    expect(q).not.toMatch(/sfPerStep/);
    expect(q).toMatch(/stair allowance/);
    expect(q).toMatch(/q\.key === "stair_landings"/);
    expect(q).toMatch(/areaPageSquareFeet/);
    expect(q).toMatch(/q\.key !== "stair_landings"/);
    expect(q).toMatch(/Job square feet/);
  });

  it("adds sized landings and the stair allowance onto one flooring total", () => {
    expect(landingJoinsQuestionCover({ key: "hs_underlayment", hardSurfaceFloor: true })).toBe(true);
    expect(landingJoinsQuestionCover({ key: "carpet_pad", hardSurfaceFloor: true })).toBe(false);
    expect(landingJoinsQuestionCover({ key: "carpet_pad", hardSurfaceFloor: false })).toBe(true);
    expect(landingJoinsQuestionCover({ kind: "selflevel", hardSurfaceFloor: true })).toBe(true);
    expect(landingPieceSqft({ lf: "6", wf: "6" })).toBe(36);
    expect(landingPieceSqft({ sqft: "40", lf: "6", wf: "6" })).toBe(40);
    expect(landingPieceSqft({})).toBe(0);

    const legacy = landingTakeoffFromAnswer({ kind: "number", value: "2" });
    expect(legacy).toEqual({ count: 2, sqft: 0, unsized: 2 });
    expect(landingReviewPhrase(legacy)).toMatch(/size not entered — not added to the square footage/);

    const sized = landingTakeoffFromAnswer({
      kind: "landings",
      rows: [
        { lf: "6", li: "0", wf: "6", wi: "0" },
        { lf: "", li: "", wf: "", wi: "", sqft: "" },
      ],
    });
    expect(sized.sqft).toBe(36);
    expect(sized.unsized).toBe(0);

    const folded = foldFloorAdditionsIntoLines(
      [
        {
          room: null,
          description: "Oak",
          category: "lvp",
          unit: "sq ft",
          sqft: 500,
          quantity: 500,
        },
        {
          room: null,
          description: "Oak wrap — wrap qty TBD (not an automatic sq ft/step order)",
          category: "lvp",
          unit: "sq ft",
          sqft: 104,
          quantity: 0,
        },
      ],
      { landingSqft: 36, stairAllowanceSqft: 104, productLabel: "Oak", productCategory: "lvp" },
    );
    expect(folded.folded).toBe(true);
    expect(folded.lines[0].sqft).toBe(640);
    expect(folded.lines[0].description).toMatch(/stair allowance 104 sq ft unwasted/);
    expect(folded.lines[1].sqft).toBe(104);

    const stamped = {
      line_type: "mat_labor" as const,
      category: "lvp",
      unit: "sq ft",
      measure_unit: "sqft" as const,
      sqft: 640,
      quantity: 640,
      waste_pct: 10,
      description: folded.lines[0].description,
      material_rate: 2,
      labor_rate: 0,
    };
    expect(lineOrderQty(stamped)).toBeCloseTo(693.6, 5);
    expect(lineTotal(stamped)).toBeCloseTo(1387.2, 5);

    const roomsOnly = computeMaterialTakeoff({
      family: "lvp",
      measuredSqft: 500,
      wastePct: 10,
      sqftPerBox: 23.64,
    });
    expect(roomsOnly.measured.sqft).toBe(500);
    expect(roomsOnly.wasteSqft).toBe(50);
    expect(roomsOnly.orderSqft).toBe(567.36);

    const withStairs = computeMaterialTakeoff({
      family: "lvp",
      measuredSqft: 536,
      includedAllowanceSqft: 104,
      wastePct: 10,
    });
    expect(withStairs.measured.sqft).toBe(640);
    expect(withStairs.wasteSqft).toBeCloseTo(53.6, 5);
    expect(withStairs.orderSqft).toBeCloseTo(693.6, 5);

    const sheet = computeMaterialTakeoff({
      family: "vinyl",
      measuredSqft: 0,
      includedAllowanceSqft: 104,
      wastePct: 10,
    });
    expect(sheet.orderBasis).toBe("none");
    expect(sheet.orderSqft).toBe(0);
    expect(sheet.measured.sqft).toBe(104);
  });

  it("puts rooms, landings, and the stair allowance on one area total", () => {
    expect(
      areaPageSquareFeet({ roomSqft: 500, landingSqft: 36, stairAllowanceSqft: 104 }),
    ).toEqual({ rooms: 500, landings: 36, stairs: 104, total: 640 });
    expect(
      areaPageSquareFeet({ roomSqft: 500, landingSqft: 0, stairAllowanceSqft: 0 }),
    ).toEqual({ rooms: 500, landings: 0, stairs: 0, total: 500 });

    const open = installContextFromValByKey({});
    expect(areaPageCollectsLandings(open)).toBe(true);
    expect(areaPageCollectsStairAllowance(open)).toBe(true);

    const carpet = installContextFromValByKey({
      project_type: ["Carpet"],
    });
    expect(areaPageCollectsLandings(carpet)).toBe(true);
    expect(areaPageCollectsStairAllowance(carpet)).toBe(false);

    const wall = installContextFromValByKey({
      project_type: ["Hard surface"],
      surface_type: ["Tile"],
      tile_application: ["Wall"],
    });
    expect(areaPageCollectsLandings(wall)).toBe(false);
    expect(areaPageCollectsStairAllowance(wall)).toBe(false);

    const mixed = installContextFromValByKey({
      project_type: ["Carpet", "Hard surface"],
      surface_type: ["LVP / LVT"],
    });
    expect(areaPageCollectsStairAllowance(mixed)).toBe(true);
  });
});

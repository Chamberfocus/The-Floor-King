import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HS_STAIR_FLOOR_SQFT_TREAD,
  HS_STAIR_FLOOR_SQFT_WITH_RISER,
  hardSurfaceStairPiecesForPlan,
  hsStairMaterialOrder,
  hsStairPlanFromAnswers,
  hsStairReviewPhrase,
  hsStairRiserWantsWhiteBoard,
  stairPieceQuoteWhenMissing,
} from "@/lib/flooring-knowledge";
import { lineOrderQty, lineQty } from "@/lib/estimate-calc";

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
  });
});

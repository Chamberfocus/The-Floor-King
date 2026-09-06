/**
 * Step 5 — stable estimate_line_items identity (upsert plan + copy strip).
 */
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_ESTIMATE_LINE_ID_MESSAGE,
  FOREIGN_ESTIMATE_LINE_ID_MESSAGE,
  MISSING_ESTIMATE_LINE_IDS_MESSAGE,
  planEstimateLinePersist,
  planPreservesLineId,
  stripLineIdentityForCopy,
} from "@/lib/estimate-line-persist";
import {
  lineOrderQty,
  lineTotal,
  optionTotals,
  type CalcLine,
} from "@/lib/estimate-calc";

const carpet: CalcLine = {
  line_type: "mat_labor",
  category: "carpet",
  unit: "sq yd",
  measure_unit: "sqyd",
  sqft: 360,
  waste_pct: 10,
  material_rate: 30,
  labor_rate: 0,
  material_cost: 20,
  labor_cost: 0,
};

describe("1. Existing line save — same UUID", () => {
  it("plans update for the existing id; no delete; no insert", () => {
    const plan = planEstimateLinePersist(["line-a"], ["line-a"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toUpdate).toEqual([{ index: 0, id: "line-a" }]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe("2. Quantity/price/description edit — same UUID", () => {
  it("identity plan is independent of commercial field changes", () => {
    // Field changes are applied on UPDATE; the plan only cares about ids.
    const plan = planEstimateLinePersist(["line-a", "line-b"], ["line-a", "line-b"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toUpdate.map((u) => u.id)).toEqual(["line-a", "line-b"]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe("3. Add new line — new insert; existing retained", () => {
  it("null id inserts; prior ids update", () => {
    const plan = planEstimateLinePersist(["line-a"], ["line-a", null]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toUpdate).toEqual([{ index: 0, id: "line-a" }]);
    expect(plan.toInsert).toEqual([1]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe("4. Remove one line — only that id deleted", () => {
  it("deletes missing id; remaining update", () => {
    const plan = planEstimateLinePersist(["line-a", "line-b", "line-c"], ["line-a", "line-c"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toDelete).toEqual(["line-b"]);
    expect(plan.toUpdate.map((u) => u.id)).toEqual(["line-a", "line-c"]);
    expect(plan.toInsert).toEqual([]);
  });
});

describe("5. Reorder — positions via index; ids stable", () => {
  it("same ids in new order → all updates, no deletes", () => {
    const plan = planEstimateLinePersist(["line-a", "line-b"], ["line-b", "line-a"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toUpdate).toEqual([
      { index: 0, id: "line-b" },
      { index: 1, id: "line-a" },
    ]);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });
});

describe("6. Forged / cross-option ID — rejected", () => {
  it("rejects id not owned by the option", () => {
    const plan = planEstimateLinePersist(["line-a"], ["line-foreign"]);
    expect(plan).toEqual({ ok: false, error: FOREIGN_ESTIMATE_LINE_ID_MESSAGE });
  });

  it("rejects mixing a valid id with a foreign id", () => {
    const plan = planEstimateLinePersist(["line-a"], ["line-a", "line-other-option"]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toBe(FOREIGN_ESTIMATE_LINE_ID_MESSAGE);
  });
});

describe("7. Existing option payload missing all IDs — reject safely", () => {
  it("does not plan delete-all when content lacks ids", () => {
    const plan = planEstimateLinePersist(["line-a", "line-b"], [null, null]);
    expect(plan).toEqual({ ok: false, error: MISSING_ESTIMATE_LINE_IDS_MESSAGE });
  });

  it("rejects empty-string ids the same as missing", () => {
    const plan = planEstimateLinePersist(["line-a"], ["", "  "]);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.error).toBe(MISSING_ESTIMATE_LINE_IDS_MESSAGE);
  });
});

describe("8. New option / no existing lines — insert without ids", () => {
  it("all null ids insert when option has no DB lines", () => {
    const plan = planEstimateLinePersist([], [null, null]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toInsert).toEqual([0, 1]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toDelete).toEqual([]);
  });
});

describe("9. Builder load → no-op save — identical ids", () => {
  it("round-trip of the same id list is update-only", () => {
    const ids = ["a", "b", "c"];
    const plan = planEstimateLinePersist(ids, ids);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toUpdate.map((u) => u.id)).toEqual(ids);
    expect(plan.toDelete).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });
});

describe("10. stock_movements.line_id survives ordinary edit", () => {
  it("edited line stays in toUpdate and is not deleted", () => {
    const plan = planEstimateLinePersist(["stock-linked"], ["stock-linked"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(planPreservesLineId(plan, "stock-linked")).toBe(true);
  });

  it("removed line is deleted (FK may SET NULL) — intentional", () => {
    const plan = planEstimateLinePersist(["keep", "drop"], ["keep"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(planPreservesLineId(plan, "keep")).toBe(true);
    expect(planPreservesLineId(plan, "drop")).toBe(false);
    expect(plan.toDelete).toEqual(["drop"]);
  });
});

describe("11. Job scope — estimate save does not rewrite job lines", () => {
  it("persist plan only references estimate line ids (no job_line_items)", () => {
    // Architectural guarantee: this module never emits job_line_items operations.
    const plan = planEstimateLinePersist(["est-1"], ["est-1"]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(JSON.stringify(plan)).not.toMatch(/job_line/i);
  });
});

describe("12–13. Duplicate option / copy estimate — strip source UUIDs", () => {
  it("stripLineIdentityForCopy removes id and timestamps", () => {
    const row = stripLineIdentityForCopy(
      {
        id: "source-uuid",
        option_id: "old-opt",
        description: "Carpet",
        created_at: "2020-01-01",
        updated_at: "2020-01-02",
      },
      "new-opt",
    );
    expect(row.id).toBeUndefined();
    expect(row.created_at).toBeUndefined();
    expect(row.updated_at).toBeUndefined();
    expect(row.option_id).toBe("new-opt");
    expect(row.description).toBe("Carpet");
  });
});

describe("14. Estimate calculations unchanged", () => {
  it("golden lineTotal / lineOrderQty / optionTotals still match engine", () => {
    expect(lineTotal(carpet)).toBeCloseTo(40 * 1.1 * 30, 10);
    expect(lineOrderQty(carpet)).toBeCloseTo(40 * 1.1, 10);
    const totals = optionTotals([carpet], 0);
    expect(totals.subtotal).toBeCloseTo(lineTotal(carpet), 10);
  });
});

describe("extra safety", () => {
  it("rejects duplicate submitted ids", () => {
    const plan = planEstimateLinePersist(["a", "b"], ["a", "a"]);
    expect(plan).toEqual({ ok: false, error: DUPLICATE_ESTIMATE_LINE_ID_MESSAGE });
  });

  it("clearing all lines (empty payload) deletes all existing — intentional", () => {
    const plan = planEstimateLinePersist(["a", "b"], []);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.toDelete.sort()).toEqual(["a", "b"]);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toInsert).toEqual([]);
  });

  it("new lines on empty option reject forged ids", () => {
    const plan = planEstimateLinePersist([], ["forged"]);
    expect(plan.ok).toBe(false);
  });
});

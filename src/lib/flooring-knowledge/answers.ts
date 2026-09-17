/**
 * Turn a questionnaire answer into the strings `show_if` / overlay read.
 *
 * Stair kinds are not yes/no. A count > 0 means the job has stairs — that
 * is the "Yes" the landings / open-sides questions were written against
 * before the old `stairs` yes/no was folded into the stair-type steps.
 */

export type GateAnswer = {
  kind: string;
  yes?: boolean;
  selected?: string[];
  rows?: { option?: string }[];
  text?: string;
  product?: { label?: string } | null;
  value?: string;
  groups?: { type?: string; count?: string }[];
  steps?: string;
};

function positiveCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/** Values a keyed answer contributes to `valByKey`. */
export function answerGateValues(a: unknown): string[] {
  if (!a || typeof a !== "object") return [];
  const ans = a as GateAnswer;
  switch (ans.kind) {
    case "yesno":
      return [ans.yes ? "Yes" : "No"];
    case "choice":
      return ans.selected ?? [];
    case "choice_areas":
      return (ans.rows ?? []).map((r) => r.option).filter((x): x is string => !!x);
    case "text": {
      const t = (ans.text ?? "").trim();
      return t ? [t] : [];
    }
    case "product":
      return ans.product?.label ? [ans.product.label] : [];
    case "number": {
      const t = (ans.value ?? "").trim();
      return t ? [t] : [];
    }
    case "stairs": {
      const groups = ans.groups ?? [];
      const active = groups.filter((g) => positiveCount(g.count) > 0);
      if (!active.length) return [];
      const types = [...new Set(active.map((g) => g.type).filter((t): t is string => !!t))];
      return ["Yes", ...types];
    }
    case "hs_stairs":
      return positiveCount(ans.steps) > 0 ? ["Yes"] : [];
    default:
      return [];
  }
}

const STAIR_SOURCE_KEYS = ["stairs", "carpet_stairs", "hs_plank_stairs"] as const;

/**
 * The live stair questions are keyed `carpet_stairs` / `hs_plank_stairs`.
 * Landings and open-sides still (and after 0196, also) look for `stairs=Yes`.
 * Copy Yes onto `stairs` so those follow-ups actually appear.
 */
export function synthesizeStairGate(valByKey: Record<string, string[]>): Record<string, string[]> {
  const hasStairs = STAIR_SOURCE_KEYS.some((k) => (valByKey[k] ?? []).includes("Yes"));
  if (!hasStairs) return valByKey;
  const cur = valByKey.stairs ?? [];
  if (cur.includes("Yes")) return valByKey;
  return { ...valByKey, stairs: [...cur, "Yes"] };
}

export type StairAnswerKind = "stairs" | "hs_stairs";

/** Step count from one stair answer. Empty / zero is 0 — never invent stairs. */
export function stairStepCountFromAnswer(a: unknown): number {
  if (!a || typeof a !== "object") return 0;
  const ans = a as GateAnswer;
  if (ans.kind === "stairs") {
    return (ans.groups ?? []).reduce((sum, g) => sum + positiveCount(g.count), 0);
  }
  if (ans.kind === "hs_stairs") {
    return positiveCount(ans.steps);
  }
  return 0;
}

/**
 * Sum of stair steps already entered on the job.
 *
 * Carpet waterfall (`stairs`) and hard-surface plank (`hs_stairs`) are
 * different constructions. Pass `kinds` to read only one — Trims fill for
 * treads/risers/noses uses hard-surface steps, not carpet steps.
 */
export function stairStepCountFromAnswers(
  answers: Record<string, unknown> | unknown[] | null | undefined,
  kinds: readonly StairAnswerKind[] = ["stairs", "hs_stairs"],
): number {
  if (!answers) return 0;
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  const allow = new Set(kinds);
  let n = 0;
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const kind = (a as GateAnswer).kind;
    if (kind !== "stairs" && kind !== "hs_stairs") continue;
    if (!allow.has(kind)) continue;
    n += stairStepCountFromAnswer(a);
  }
  return n;
}

/** Existing TRIM_TYPES labels — do not invent Versatrim SKUs or prices. */
export const HARD_SURFACE_STAIR_TRIM_LABELS = ["Stair tread", "Stair riser", "Stair nose"] as const;

export type HardSurfaceStairTrimLabel = (typeof HARD_SURFACE_STAIR_TRIM_LABELS)[number];

function matchHardSurfaceStairTrim(type: string, label: HardSurfaceStairTrimLabel): boolean {
  if (label === "Stair nose") return /stair\s*nose/i.test(type);
  if (label === "Stair tread") return /tread/i.test(type);
  return /riser/i.test(type);
}

/**
 * Set qty = step count on stair tread, riser, and nose rows (adding any that
 * are missing). Stair noses are EACH, never square feet — the caller must
 * create rows with the existing trim type unit.
 */
export function applyHardSurfaceStairTrimFill<T extends { type: string; qty: string }>(
  rows: T[],
  stepCount: number,
  addRow: (label: HardSurfaceStairTrimLabel) => T,
): T[] {
  if (!(stepCount > 0)) return rows;
  const qty = String(Math.ceil(stepCount));
  let rs = [...rows];
  for (const label of HARD_SURFACE_STAIR_TRIM_LABELS) {
    const idx = rs.findIndex((x) => matchHardSurfaceStairTrim(x.type, label));
    if (idx >= 0) {
      rs[idx] = { ...rs[idx], qty };
    } else {
      rs = [...rs, { ...addRow(label), qty }];
    }
  }
  return rs;
}

/** True when a trims answer already has a row matching `type` (e.g. stair nose). */
export function answersHaveTrimType(
  answers: Record<string, unknown> | unknown[] | null | undefined,
  match: RegExp,
): boolean {
  if (!answers) return false;
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const ans = a as { kind?: string; rows?: { type?: string }[] };
    if (ans.kind !== "trims") continue;
    if ((ans.rows ?? []).some((r) => match.test(r.type ?? ""))) return true;
  }
  return false;
}

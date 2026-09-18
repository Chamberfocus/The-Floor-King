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

/**
 * yesno ↔ choice Yes/No so a kind change (subfloor Field verify in 0206)
 * does not drop in-flight drafts. Field verify / other choice labels are
 * left alone — never coerced into a fake No.
 */
export function coerceYesNoChoiceAnswer(questionKind: string, a: unknown): unknown {
  if (!a || typeof a !== "object") return a;
  const ans = a as GateAnswer & { note?: string };
  if (questionKind === "choice" && ans.kind === "yesno") {
    const selected = [ans.yes ? "Yes" : "No"];
    return ans.note ? { kind: "choice", selected, note: ans.note } : { kind: "choice", selected };
  }
  if (questionKind === "yesno" && ans.kind === "choice") {
    const s = (ans.selected ?? [])[0] ?? "";
    if (/^yes$/i.test(s)) return { kind: "yesno", yes: true };
    if (/^no$/i.test(s)) return { kind: "yesno", yes: false };
  }
  return a;
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

const STAIR_SOURCE_KEYS = ["stairs", "carpet_stairs", "hs_plank_stairs", "carpet_tile_stairs"] as const;

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

const SKIP_TRIM_PICK = /none|keep existing|field verify|tbd/i;

/** Option label → existing TRIM_TYPES label. Doorway pieces are EACH. */
export const HS_TRANSITION_OPTION_TO_TRIM: Record<string, string> = {
  "T-mold": "T-mold",
  Reducer: "Reducer",
  "End cap": "End cap",
  Threshold: "Threshold",
  Metal: "Metal transition",
  "Metal transition": "Metal transition",
};

/** Option label → existing TRIM_TYPES label. Base/QR/shoe are LN FT. */
export const HS_BASE_OPTION_TO_TRIM: Record<string, string> = {
  "Quarter round": "Quarter round",
  "Shoe molding": "Shoe molding",
  Baseboard: "Baseboard",
};

/** TRIM_TYPES labels implied by a notes-only pick list (skips None / TBD). */
export function trimLabelsFromPicks(selected: string[] | undefined, map: Record<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of selected ?? []) {
    if (!s || SKIP_TRIM_PICK.test(s)) continue;
    const label = map[s];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function applyTrimTypeSeed<T extends { type: string }>(
  rows: T[],
  labels: string[],
  addRow: (label: string) => T,
): T[] {
  if (!labels.length) return rows;
  let rs = [...rows];
  for (const label of labels) {
    if (rs.some((x) => x.type.trim().toLowerCase() === label.toLowerCase())) continue;
    rs = [...rs, addRow(label)];
  }
  return rs;
}

export function presentTrimTypes(
  answers: Record<string, unknown> | unknown[] | null | undefined,
): string[] {
  if (!answers) return [];
  const values = Array.isArray(answers) ? answers : Object.values(answers);
  const types: string[] = [];
  for (const a of values) {
    if (!a || typeof a !== "object") continue;
    const ans = a as { kind?: string; rows?: { type?: string }[] };
    if (ans.kind !== "trims") continue;
    for (const r of ans.rows ?? []) {
      const t = (r.type ?? "").trim();
      if (t) types.push(t);
    }
  }
  return types;
}

/** Choice selections for a keyed question (questionnaire answers are id-keyed). */
export function keyedChoiceSelections(
  questions: { id: string; key?: string | null }[],
  answers: Record<string, unknown>,
  key: string,
): string[] {
  const q = questions.find((x) => x.key === key);
  if (!q) return [];
  return answerGateValues(answers[q.id]);
}

/**
 * Suffix a tear-out line with glued-vs-floating / pad-reuse notes.
 * Does not change the catalog demo rate — Floor King prices LVP demo the same
 * until a separate glued-demo item exists.
 */
export function annotateRemovalDescription(
  description: string,
  opts: { bond?: string[]; pad?: string[]; tack?: string[] },
): string {
  if (!/tear-?out|demo|removal/i.test(description)) return description;
  const bits: string[] = [];
  const isHsVinyl = /lvp|laminate|vinyl|sheet/i.test(description);
  const isCarpet = /carpet/i.test(description) || /old floor/i.test(description);
  if (isHsVinyl) {
    const bond = opts.bond ?? [];
    if (bond.some((l) => /floating/i.test(l))) bits.push("floating / click — not glued");
    else if (bond.some((l) => /glued down/i.test(l))) bits.push("glued down — not floating");
    else if (bond.some((l) => /unknown|field verify|tbd/i.test(l))) bits.push("bond field verify");
  }
  if (isCarpet) {
    const pad = opts.pad ?? [];
    if (pad.some((l) => /reuse/i.test(l))) bits.push("reuse existing pad (explicit)");
    else if (pad.some((l) => /remove/i.test(l))) bits.push("pad removed with carpet");
    else if (pad.some((l) => /no pad/i.test(l))) bits.push("no pad");
    const tack = opts.tack ?? [];
    if (tack.some((l) => /keep/i.test(l))) bits.push("keep existing tack strip (unusual)");
    else if (tack.some((l) => /remove/i.test(l))) bits.push("tack strip removed with carpet");
    else if (tack.some((l) => /no tack/i.test(l))) bits.push("no tack strip");
    else if (tack.some((l) => /unknown|field verify|tbd/i.test(l))) bits.push("tack strip field verify");
  }
  if (!bits.length) return description;
  return `${description} (${bits.join("; ")})`;
}

export const WORK_TYPE_NEW_CONSTRUCTION = "New construction";

export function labelsAreNewConstruction(labels: string[]): boolean {
  return labels.some((l) => /^new construction$/i.test(l.trim()));
}

export function jobIsNewConstruction(valByKey: Record<string, string[]>): boolean {
  return labelsAreNewConstruction(valByKey.work_type ?? []);
}

/** Exclusive Wall — Floor / Both / Unknown / unanswered are not wall-only. */
export function labelsAreWallOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^wall$/i.test(l));
}

export function tileJobIsWallOnly(valByKey: Record<string, string[]>): boolean {
  return labelsAreWallOnly(valByKey.tile_application ?? []);
}

export function labelsAreVacant(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^vacant$/i.test(l));
}

export function jobIsVacant(valByKey: Record<string, string[]>): boolean {
  return labelsAreVacant(valByKey.occupancy ?? []);
}

/** Exclusive Concrete — plywood / wood / existing / unknown / unanswered stay open. */
export function labelsAreConcreteOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^concrete(\s+slab)?$/i.test(l));
}

export function jobIsExclusiveConcreteSubstrate(valByKey: Record<string, string[]>): boolean {
  return labelsAreConcreteOnly(valByKey.substrate ?? valByKey.subfloor_type ?? []);
}

/**
 * Exclusive plywood / OSB / wood deck. Concrete, existing flooring, Other,
 * and Unknown / unanswered stay open (0142).
 */
export function labelsAreWoodDeckOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^(plywood(\s*\/\s*osb)?|osb|wood)$/i.test(l));
}

/**
 * Exclusive Existing flooring. Concrete, plywood, Other, and Unknown /
 * unanswered stay open (0142). Mixed existing + concrete stays open.
 */
export function labelsAreExistingFlooringOnly(labels: string[]): boolean {
  const cleaned = labels.map((l) => l.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return cleaned.every((l) => /^existing flooring$/i.test(l));
}

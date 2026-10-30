/**
 * Conditional visibility for estimate questions.
 *
 * The original shape `{ key, in }` is still the common case. Compound
 * `all` / `any` lets a question require more than one prior answer without
 * nesting JSX. Evaluation is pure so the questionnaire, settings, and tests
 * share one implementation.
 */

import type { ShowIfClause } from "@/lib/types";

export function isShowIfClause(v: unknown): v is ShowIfClause {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.key === "string" && Array.isArray(o.in)) return true;
  if (Array.isArray(o.all)) return true;
  if (Array.isArray(o.any)) return true;
  return false;
}

/**
 * True when the clause matches the answers currently in play.
 * A missing/empty clause shows the question. Hidden questions must not
 * contribute to `valByKey` (the questionnaire loop already enforces that).
 */
export function matchesShowIf(
  clause: ShowIfClause | null | undefined,
  valByKey: Record<string, string[]>,
): boolean {
  if (!clause) return true;
  if ("all" in clause && clause.all) {
    if (!clause.all.length) return true;
    return clause.all.every((c) => matchesShowIf(c, valByKey));
  }
  if ("any" in clause && clause.any) {
    if (!clause.any.length) return true;
    return clause.any.some((c) => matchesShowIf(c, valByKey));
  }
  if ("key" in clause && clause.key) {
    const want = clause.in ?? [];
    if (!want.length) return true;
    const have = valByKey[clause.key] ?? [];
    return have.some((v) => want.includes(v));
  }
  return true;
}

/**
 * An older unkeyed question with the same label as a keyed question that is
 * already on screen. The keyed question is the one later steps read (for
 * example floor prep opening self-leveler bags). Asking both is the same
 * question twice, and the unkeyed answer does not drive those steps.
 * If the keyed question is hidden, the older question stays.
 */
export function hideUnkeyedLabelDuplicates<
  T extends { id: string; key?: string | null; label?: string | null },
>(questions: T[], visible: Record<string, boolean>): Record<string, boolean> {
  const keyedLabels = new Set<string>();
  for (const q of questions) {
    const key = (q.key ?? "").trim();
    const label = (q.label ?? "").trim().toLowerCase();
    if (!key || !label || !visible[q.id]) continue;
    keyedLabels.add(label);
  }
  const next: Record<string, boolean> = { ...visible };
  for (const q of questions) {
    if ((q.key ?? "").trim()) continue;
    const label = (q.label ?? "").trim().toLowerCase();
    if (!label || !next[q.id]) continue;
    if (keyedLabels.has(label)) next[q.id] = false;
  }
  return next;
}

/**
 * Two questions with the same label are the same question. Keep the first
 * keyed one (that is what later steps read). Hide the rest.
 */
export function hideDuplicateQuestionLabels<
  T extends { id: string; key?: string | null; label?: string | null },
>(questions: T[], visible: Record<string, boolean>): Record<string, boolean> {
  const next: Record<string, boolean> = { ...visible };
  const groups = new Map<string, T[]>();
  for (const q of questions) {
    if (!next[q.id]) continue;
    const label = (q.label ?? "").trim().toLowerCase();
    if (!label) continue;
    const list = groups.get(label) ?? [];
    list.push(q);
    groups.set(label, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const keep = list.find((q) => (q.key ?? "").trim()) ?? list[0];
    for (const q of list) {
      if (q.id !== keep.id) next[q.id] = false;
    }
  }
  return next;
}

/**
 * Hard-surface questions that still leak onto a carpet-only walk (radiant
 * heat has no family gate; 6-mil vapor opens on any concrete slab). Carpet
 * keeps pad, tack, stairs, metals, substrate, and glue/tile moisture.
 */
const CARPET_QUESTIONNAIRE_EXTRA_HIDE = new Set([
  "radiant_heat",
  "vapor_barrier",
  "hs_direction",
  "hs_transitions",
  "hs_base_trim",
  "hs_plank_stairs",
  "install_method",
  "surface_type",
  "hardwood_finish",
  "hardwood_fasteners",
  "laminate_expansion",
  "attached_pad",
  "hs_underlayment",
  "vinyl_layout",
  "vinyl_skim",
  "construction_grade",
  "tile_application",
  "tile_body",
  "tile_format",
  "tile_layout",
  "tile_setting",
]);

export function simplifyCarpetQuestionnaire<
  T extends { id: string; key?: string | null; label?: string | null },
>(
  questions: T[],
  visible: Record<string, boolean>,
  exclusiveCarpet: boolean,
): Record<string, boolean> {
  const next = hideDuplicateQuestionLabels(questions, visible);
  if (!exclusiveCarpet) return next;
  for (const q of questions) {
    const key = (q.key ?? "").trim();
    if (key && CARPET_QUESTIONNAIRE_EXTRA_HIDE.has(key)) next[q.id] = false;
  }
  return next;
}

/** Keys a `show_if` clause reads — used so dependents never sort before their gates. */
export function showIfReferencedKeys(clause: ShowIfClause | null | undefined): string[] {
  if (!clause) return [];
  if ("all" in clause && clause.all) return clause.all.flatMap(showIfReferencedKeys);
  if ("any" in clause && clause.any) return clause.any.flatMap(showIfReferencedKeys);
  if ("key" in clause && clause.key) return [clause.key];
  return [];
}

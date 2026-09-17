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

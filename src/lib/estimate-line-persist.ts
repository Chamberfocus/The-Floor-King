/**
 * Stable estimate line identity (Step 5).
 *
 * Plans per-option upserts for `estimate_line_items`: update by owned id,
 * insert new rows, delete only intentionally removed rows. Never delete-all.
 */

/** Shown when an old tab / draft submits lines without DB ids on an option that already has lines. */
export const MISSING_ESTIMATE_LINE_IDS_MESSAGE =
  "This estimate was opened before a recent update. Refresh the page, then save again.";

/** Shown when a submitted line id does not belong to the option being saved. */
export const FOREIGN_ESTIMATE_LINE_ID_MESSAGE =
  "One or more line items could not be saved. Refresh the page and try again.";

/** Shown when the same line id appears more than once in the payload. */
export const DUPLICATE_ESTIMATE_LINE_ID_MESSAGE =
  "One or more line items could not be saved. Refresh the page and try again.";

export type LinePersistPlan =
  | {
      ok: true;
      /** Submitted indices that UPDATE an existing row (id already on this option). */
      toUpdate: Array<{ index: number; id: string }>;
      /** Submitted indices that INSERT a new row (no id). */
      toInsert: number[];
      /** Existing DB ids for this option that are absent from the payload → hard delete. */
      toDelete: string[];
    }
  | { ok: false; error: string };

function normalizeId(id: string | null | undefined): string | null {
  if (id == null) return null;
  const t = String(id).trim();
  return t.length ? t : null;
}

/**
 * Decide update / insert / delete for one option's lines.
 *
 * @param existingIds — current `estimate_line_items.id` values for this option
 * @param submittedIds — parallel to submitted lines; null/undefined = new line
 */
export function planEstimateLinePersist(
  existingIds: readonly string[],
  submittedIds: ReadonlyArray<string | null | undefined>,
): LinePersistPlan {
  const existing = new Set(existingIds.map((id) => id.trim()).filter(Boolean));
  const normalized = submittedIds.map(normalizeId);

  const seen = new Set<string>();
  for (const id of normalized) {
    if (!id) continue;
    if (seen.has(id)) {
      return { ok: false, error: DUPLICATE_ESTIMATE_LINE_ID_MESSAGE };
    }
    seen.add(id);
    if (!existing.has(id)) {
      return { ok: false, error: FOREIGN_ESTIMATE_LINE_ID_MESSAGE };
    }
  }

  // Old tab / incomplete payload: option already has lines, payload has content,
  // but no ids — would recreate UUID churn. Reject instead of delete+reinsert.
  if (
    existing.size > 0 &&
    normalized.length > 0 &&
    normalized.every((id) => id == null)
  ) {
    return { ok: false, error: MISSING_ESTIMATE_LINE_IDS_MESSAGE };
  }

  const toUpdate: Array<{ index: number; id: string }> = [];
  const toInsert: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const id = normalized[i];
    if (id) toUpdate.push({ index: i, id });
    else toInsert.push(i);
  }

  const submittedSet = new Set(toUpdate.map((u) => u.id));
  const toDelete = [...existing].filter((id) => !submittedSet.has(id));

  return { ok: true, toUpdate, toInsert, toDelete };
}

/** True when a planned save keeps `lineId` as an update (stock_movements stay linked). */
export function planPreservesLineId(
  plan: Extract<LinePersistPlan, { ok: true }>,
  lineId: string,
): boolean {
  return plan.toUpdate.some((u) => u.id === lineId) && !plan.toDelete.includes(lineId);
}

/**
 * Strip row identity so a line can be inserted under a new option/estimate.
 * Used by duplicate-option and copy-estimate flows.
 */
export function stripLineIdentityForCopy(
  line: Record<string, unknown>,
  optionId: string,
): Record<string, unknown> {
  const row: Record<string, unknown> = { ...line, option_id: optionId };
  delete row.id;
  delete row.created_at;
  delete row.updated_at;
  return row;
}

/**
 * Estimate approval UI — one canonical option pick, never silent first-option.
 */

export type EstimateApproveOptionMode = "blocked" | "single" | "picker";

export function estimateApproveOptionMode(
  optionIds: readonly string[],
): EstimateApproveOptionMode {
  if (optionIds.length === 0) return "blocked";
  if (optionIds.length === 1) return "single";
  return "picker";
}

/** Checklist one-tap is only safe when exactly one option exists. */
export function checklistCanOneTapApprove(
  optionIds: readonly string[],
): optionIds is readonly [string] {
  return estimateApproveOptionMode(optionIds) === "single";
}

export const APPROVE_OPTION_REQUIRED_MESSAGE =
  "Pick which option the customer accepted before approving.";

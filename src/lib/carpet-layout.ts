// Carpet seam/cut planner. Carpet comes on a roll of a fixed width (usually
// 12'), so a room is covered by full-width "drops" run in ONE direction (so the
// nap/pile matches across seams). A room wider than the roll needs a fill drop
// and a seam. Patterned carpet must have each drop length rounded UP to a whole
// pattern repeat so the pattern matches across the seam.
//
// This is deterministic flooring math (the standard fill method) — no guessing.

export type RunDirection = "length" | "width";
export type RunChoice = "auto" | "length" | "width";

export interface CarpetInput {
  roomLengthFt: number;
  roomWidthFt: number;
  rollWidthFt: number; // 12, 13.5, 15…
  patternRepeatIn: number; // 0 = plain (no repeat)
  seamAllowanceIn: number; // extra length cut on each drop for trimming
  run: RunChoice;
}

export interface CarpetDrop {
  index: number;
  acrossStartFt: number; // position along the across-axis
  widthFt: number; // coverage width off the roll (last may be a narrow fill)
  cutLengthFt: number; // length cut off the roll (incl. allowance + pattern)
  coverLengthFt: number; // length it actually covers in the room
  isFill: boolean;
}

export interface CarpetPlan {
  runDirection: RunDirection; // direction the carpet (and nap) runs
  rollWidthFt: number;
  drops: CarpetDrop[];
  seams: number[]; // seam positions along the across-axis (ft)
  linearFt: number; // total length pulled off the roll
  purchasedSqft: number; // linearFt × rollWidth
  purchasedSqyd: number;
  roomSqft: number;
  roomSqyd: number;
  wastePct: number;
  patternRepeatIn: number;
  seamAllowanceIn: number;
}

interface RunResult {
  drops: CarpetDrop[];
  seams: number[];
  linearFt: number;
  cutLengthFt: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Plan a single run direction: drops of `runLengthFt` laid across `acrossFt`. */
function planRun(
  runLengthFt: number,
  acrossFt: number,
  input: CarpetInput,
): RunResult {
  const repeatFt = input.patternRepeatIn > 0 ? input.patternRepeatIn / 12 : 0;
  const allowanceFt = input.seamAllowanceIn / 12;

  // Every drop is cut the same length so the pattern (and trim) lines up.
  let cutLengthFt = runLengthFt + allowanceFt;
  if (repeatFt > 0) cutLengthFt = Math.ceil(cutLengthFt / repeatFt) * repeatFt;
  cutLengthFt = round2(cutLengthFt);

  const nDrops = Math.max(1, Math.ceil(acrossFt / input.rollWidthFt));
  const drops: CarpetDrop[] = [];
  const seams: number[] = [];
  let pos = 0;
  for (let i = 0; i < nDrops; i++) {
    const remaining = acrossFt - pos;
    const widthFt = round2(Math.min(input.rollWidthFt, remaining));
    if (i > 0) seams.push(round2(pos));
    drops.push({
      index: i + 1,
      acrossStartFt: round2(pos),
      widthFt,
      cutLengthFt,
      coverLengthFt: round2(runLengthFt),
      isFill: i === nDrops - 1 && widthFt < input.rollWidthFt - 0.01,
    });
    pos += widthFt;
  }
  return { drops, seams, linearFt: round2(nDrops * cutLengthFt), cutLengthFt };
}

/**
 * Build the best carpet cut plan for a rectangular room. "auto" compares running
 * the carpet down the length vs across the width and keeps whichever buys less
 * carpet (less seam waste); you can also force a direction.
 */
export function planCarpet(input: CarpetInput): CarpetPlan | null {
  const L = input.roomLengthFt;
  const W = input.roomWidthFt;
  if (!(L > 0) || !(W > 0) || !(input.rollWidthFt > 0)) return null;

  // Run "length" = drops run along L, laid across the width W.
  const byLength = planRun(L, W, input);
  // Run "width" = drops run along W, laid across the length L.
  const byWidth = planRun(W, L, input);

  let runDirection: RunDirection;
  let chosen: RunResult;
  if (input.run === "length") {
    runDirection = "length";
    chosen = byLength;
  } else if (input.run === "width") {
    runDirection = "width";
    chosen = byWidth;
  } else if (byWidth.linearFt < byLength.linearFt) {
    runDirection = "width";
    chosen = byWidth;
  } else {
    runDirection = "length";
    chosen = byLength;
  }

  const roomSqft = round2(L * W);
  const purchasedSqft = round2(chosen.linearFt * input.rollWidthFt);
  const wastePct =
    roomSqft > 0 ? round2(((purchasedSqft - roomSqft) / roomSqft) * 100) : 0;

  return {
    runDirection,
    rollWidthFt: input.rollWidthFt,
    drops: chosen.drops,
    seams: chosen.seams,
    linearFt: chosen.linearFt,
    purchasedSqft,
    purchasedSqyd: round2(purchasedSqft / 9),
    roomSqft,
    roomSqyd: round2(roomSqft / 9),
    wastePct,
    patternRepeatIn: input.patternRepeatIn,
    seamAllowanceIn: input.seamAllowanceIn,
  };
}

/** Pretty feet → e.g. 12'6". */
export function ftToFtIn(ft: number): string {
  if (!Number.isFinite(ft)) return "0'";
  const whole = Math.floor(ft + 1e-9);
  const inches = Math.round((ft - whole) * 12);
  if (inches === 12) return `${whole + 1}'`;
  return inches > 0 ? `${whole}'${inches}"` : `${whole}'`;
}

export const ROLL_WIDTHS = [12, 13.5, 15] as const;

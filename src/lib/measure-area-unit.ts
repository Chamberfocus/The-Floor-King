/**
 * Salesperson working unit for measured area.
 *
 * Dimensions stay feet and inches. Stored area stays square feet so billing,
 * takeoff, and saved rooms keep one number. Display and typed totals convert
 * with ÷9 and ×9. Flipping the unit changes what is shown. A half-typed total
 * is saved in square feet first, so the measurement comes back in either unit.
 */

export type MeasureAreaUnit = "sqft" | "sqyd";

export const SQFT_PER_SQYD = 9;

export function measureAreaUnitLabel(unit: MeasureAreaUnit): string {
  return unit === "sqyd" ? "sq yd" : "sq ft";
}

/** Square feet → the number shown in the working unit (2 decimal places). */
export function formatMeasureArea(sqft: number, unit: MeasureAreaUnit): string {
  if (!Number.isFinite(sqft)) return "";
  const n =
    unit === "sqyd"
      ? Math.round((sqft / SQFT_PER_SQYD) * 100) / 100
      : Math.round(sqft * 100) / 100;
  if (Object.is(n, -0)) return "0";
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function formatMeasureAreaLabel(sqft: number, unit: MeasureAreaUnit): string {
  const n = formatMeasureArea(sqft, unit);
  return `${n || "0"} ${measureAreaUnitLabel(unit)}`;
}

/**
 * Typed total in the working unit → square feet stored on the room or line.
 * Returns null while the text is not a number yet (a lone "."), so the field
 * can keep the keystroke without wiping the saved area.
 */
export function commitMeasureAreaInput(text: string, unit: MeasureAreaUnit): string | null {
  const t = text.trim();
  if (t === "") return "";
  if (!/^\d+\.?\d*$|^\d*\.\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  const sqft = unit === "sqyd" ? Math.round(n * SQFT_PER_SQYD * 100) / 100 : Math.round(n * 100) / 100;
  return String(sqft);
}

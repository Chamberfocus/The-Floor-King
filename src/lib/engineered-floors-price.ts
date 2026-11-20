/**
 * Engineered Floors customer price listing (PRTPRC).
 *
 * One style code is often several products: the plank, the end cap, the
 * reducer. Carpet is priced per square yard; the cut is what we pay to cut
 * a piece off the roll, and the lower STD price is the full roll when the
 * two differ. Hard surface and trim use the cut when the sheet prints one,
 * and the only price when it prints one. Catalog material_rate stays that
 * cost. This list is styles, not colorways — no color is invented.
 */
import type { PriceRow } from "@/lib/extract";

const BRANDS = new Set(["DW", "EF", "HS", "PNZ", "PHS"]);

const ROW_RE =
  /^([A-Z0-9]{3,8})\s+(.+?)\s+(\$\d*\.\d{2})(?:\s+(\$\d*\.\d{2}))?\s+(SY|SF|EA)$/;

const FIBER_RE =
  /\s+(?:PURECOLOR(?:\s+SOFT)?(?:\s+POLY(?:ESTER)?)?|PURECOLOR\s+HIDEF|PURECOLOR\s+NYLON|MAIN STREET(?:\s+TILE|\s+BL)?(?:\s+PLY|\s+NYL|\s+POLY)?|LAMINATE|ADHESIVE|LVT|NYL|PLY|POLY)$/i;

const NOISE_BACK_RE = /\s+(?:ACTION|NEXUS|IND ITEM|TRIM\/ACCESS|PRMRBCPL)$/i;

const SIZE_RE = /^(?:\d+\s*'|\d+\s*"|\d+\s*x\s*\d+)/i;

export function looksLikeEngineeredFloorsPriceList(text: string): boolean {
  if (/ENGINEERED FLOORS/i.test(text)) return true;
  return /TRIM\/ACCESS/.test(text) && /PURECOLOR/.test(text);
}

function money(token: string): number {
  return Math.round(parseFloat(token.replace("$", "")) * 100) / 100;
}

function expandWords(raw: string): string {
  return raw
    .replace(/([A-HJ-Z])(III|II|IV)\b/g, "$1 $2")
    .replace(/\bLUX\s+VNYL\b/gi, "Lux Vinyl")
    .replace(/\bFLSHSTNS\b/gi, "Flush Stair Nose")
    .replace(/\bOVRLPSTN\b/gi, "Overlap Stair Nose")
    .replace(/\b2STRTRDS\b/gi, "Stair Treads")
    .replace(/\bFLUSHSTR\b/gi, "Flush Stair")
    .replace(/\bTMOLDING\b/gi, "T Molding")
    .replace(/\bT\s+MOLD\b/gi, "T Mold")
    .replace(/(\d)\s*[xX]\s*(\d)/g, "$1x$2")
    .replace(/\bX\b/g, "x");
}

function titleCase(raw: string): string {
  const s = expandWords(raw);
  return s
    .toLowerCase()
    .replace(/(^|[\s/("'-])([a-z])/g, (_, lead: string, ch: string) => lead + ch.toUpperCase())
    .replace(/\bIi\b/g, "II")
    .replace(/\bIii\b/g, "III")
    .replace(/\bIv\b/g, "IV")
    .replace(/(\d"?)\s+X\s+(\d)/g, "$1 x $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Drop mill boilerplate (fiber, backing, roll weight, brand). Keep the size and the piece. */
function productWords(middle: string): string {
  let s = middle.replace(/\s+/g, " ").trim();
  const brand = s.split(" ").pop() ?? "";
  if (BRANDS.has(brand)) s = s.slice(0, -brand.length).trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(FIBER_RE, "").replace(NOISE_BACK_RE, "").trim();
    s = s.replace(/\s+\d+\.\d{2}$/, "").trim();
  }
  // A leftover roll count ("24x24 5") is not a size.
  if (/\d/.test(s.slice(0, -2)) && /\s+\d+$/.test(s)) s = s.replace(/\s+\d+$/, "").trim();
  return s;
}

function styleName(words: string): string {
  const parts = words.split(/\s+/);
  const kept: string[] = [];
  for (const part of parts) {
    if (SIZE_RE.test(parts.slice(kept.length).join(" "))) break;
    kept.push(part);
  }
  const style = kept.join(" ").trim();
  return style || words;
}

function categoryFor(middle: string, um: string): string {
  const d = middle.toUpperCase();
  if (/ADHESIVE|TILE TAB/.test(d)) return "other";
  if (
    um === "EA" ||
    /TRIM\/ACCESS|END CAP|REDUCER|\bT MOLD\b|TMOLDING|QUARTER|FLSHSTN|FLUSHSTR|OVRLPSTN|2STRTRDS/.test(d)
  ) {
    return "trim";
  }
  if (/LAMINATE/.test(d)) return "laminate";
  if (um === "SF" || /\bLVT\b|LUX VNYL|DRY BACK/.test(d)) return "lvp";
  if (um === "SY") return "carpet";
  return "other";
}

function unitFor(um: string): string {
  if (um === "SY") return "sqyd";
  if (um === "SF") return "sqft";
  return "each";
}

function isCarpetTile(middle: string, um: string): boolean {
  if (um !== "SY") return false;
  return /MODULAR|\bMOD\b|24X24|18X18|12X48|SMART SQUARES|\bTILE\b/.test(middle.toUpperCase());
}

function noteFor(
  sku: string,
  middle: string,
  um: string,
  std: number | null,
  cut: number,
): string {
  const parts = [`Style ${sku}.`, "Engineered Floors price list effective 11/16/2026."];
  if (isCarpetTile(middle, um)) parts.push("Carpet tile.");
  if (std != null) {
    parts.push(`STD $${std.toFixed(2)}. Cut $${cut.toFixed(2)}.`);
  } else {
    parts.push(`Price $${cut.toFixed(2)}.`);
  }
  return parts.join(" ");
}

export function parseEngineeredFloorsPriceList(text: string): PriceRow[] | null {
  if (!looksLikeEngineeredFloorsPriceList(text)) return null;
  const draft: PriceRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const m = line.match(ROW_RE);
    if (!m) continue;
    const sku = m[1];
    const middle = m[2].trim();
    const first = money(m[3]);
    const second = m[4] ? money(m[4]) : null;
    const um = m[5];
    const std = second != null ? first : null;
    // Carpet: the cut is the catalog cost, and STD is the full-roll price
    // when it is cheaper. Hard surface is bought by the carton, so the
    // catalog cost is the lower STD price. The higher cut stays in the note.
    const hardSurface = um === "SF";
    const cut = hardSurface ? first : (second ?? first);
    const roll = !hardSurface && std != null && std !== cut ? std : null;
    const words = productWords(middle);
    if (!words) continue;
    const name = titleCase(words);
    const style = titleCase(styleName(words));
    draft.push({
      name,
      category: categoryFor(middle, um),
      unit: unitFor(um),
      sku,
      material_rate: cut,
      roll_rate: roll,
      labor_rate: null,
      manufacturer: "Engineered Floors",
      style,
      color: null,
      notes: noteFor(sku, middle, um, second != null ? first : null, second ?? first),
    });
  }
  if (draft.length < 5) return null;

  const counts = new Map<string, number>();
  for (const row of draft) {
    const key = row.name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return draft.map((row) => {
    if ((counts.get(row.name.toLowerCase()) ?? 0) < 2) return row;
    return { ...row, name: `${row.name} (${row.sku})` };
  });
}

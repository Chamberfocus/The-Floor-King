/**
 * Turn PDF text fragments into rows a price list can parse.
 * Column gaps become tabs. Words in the same cell stay together.
 * A two-column page is read left side, then right side, so a price
 * on the right is not glued onto the product on the left.
 */

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfJsLike = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

export function pdfJsItems(items: PdfJsLike[]): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const it of items) {
    const str = (it.str ?? "").replace(/\s+/g, " ").trim();
    if (!str || !it.transform || it.transform.length < 6) continue;
    const height =
      it.height && it.height > 0
        ? it.height
        : Math.hypot(it.transform[2] ?? 0, it.transform[3] ?? 0) || 8;
    const width =
      it.width && it.width > 0
        ? it.width
        : Math.max(str.length, 1) * height * 0.5;
    out.push({
      str,
      x: it.transform[4],
      y: it.transform[5],
      width,
      height,
    });
  }
  return out;
}

function isFurniture(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^\d{1,4}$/.test(t)) return true;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return true;
  return false;
}

function joinRow(items: PdfTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  let line = "";
  let prev: PdfTextItem | null = null;
  for (const it of sorted) {
    if (prev) {
      const gap = it.x - (prev.x + prev.width);
      const charW = prev.width / Math.max(prev.str.length, 1);
      // Cap the column threshold so a long word does not swallow the next column.
      const columnGap = Math.max(12, Math.min(charW * 1.8, 18));
      if (gap > columnGap) line += "\t";
      else if (gap > Math.max(charW * 0.34, 1.2)) line += " ";
    }
    line += it.str;
    prev = it;
  }
  return line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, "");
}

function layoutColumn(items: PdfTextItem[]): string {
  if (!items.length) return "";
  const heights = items.map((it) => it.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 8;
  const tol = Math.min(6, Math.max(2, median * 0.55));
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  let current: { y: number; items: PdfTextItem[] } | null = null;
  for (const it of sorted) {
    if (!current || current.y - it.y > tol) {
      current = { y: it.y, items: [it] };
      rows.push(current.items);
    } else {
      current.items.push(it);
    }
  }
  const lines: string[] = [];
  for (const row of rows) {
    const line = joinRow(row);
    if (!isFurniture(line)) lines.push(line);
  }
  return lines.join("\n");
}

function xSpan(items: PdfTextItem[]): number {
  if (!items.length) return 0;
  const min = Math.min(...items.map((it) => it.x));
  const max = Math.max(...items.map((it) => it.x + it.width));
  return max - min;
}

/**
 * A real two-column page has a wide empty gutter and a full block of
 * text on each side. A single table's gap before the price column is
 * narrower on the price side, so it stays one table.
 */
function findGutter(items: PdfTextItem[]): number | null {
  if (items.length < 12) return null;
  const minX = Math.min(...items.map((it) => it.x));
  const maxX = Math.max(...items.map((it) => it.x + it.width));
  const span = maxX - minX;
  if (span < 280) return null;
  const step = 4;
  const bins = Math.ceil(span / step) + 1;
  const occ = new Array<number>(bins).fill(0);
  for (const it of items) {
    const a = Math.max(0, Math.floor((it.x - minX) / step));
    const b = Math.min(bins - 1, Math.floor((it.x + it.width - minX) / step));
    for (let i = a; i <= b; i++) occ[i] += 1;
  }
  const midL = Math.floor(bins * 0.3);
  const midR = Math.ceil(bins * 0.7);
  let bestStart = -1;
  let bestLen = 0;
  let run = 0;
  let runStart = 0;
  for (let i = midL; i <= midR; i++) {
    if (occ[i] === 0) {
      if (run === 0) runStart = i;
      run += 1;
      if (run > bestLen) {
        bestLen = run;
        bestStart = runStart;
      }
    } else {
      run = 0;
    }
  }
  if (bestLen * step < 48) return null;
  const gutter = minX + (bestStart + bestLen / 2) * step;
  const left = items.filter((it) => it.x + it.width <= gutter);
  const right = items.filter((it) => it.x >= gutter);
  if (left.length < 4 || right.length < 4) return null;
  if (xSpan(left) < 80 || xSpan(right) < 80) return null;
  return gutter;
}

/** One page of text items → lines. Columns inside a row are tab-separated. */
export function layoutPdfPage(items: PdfTextItem[]): string {
  if (!items.length) return "";
  const gutter = findGutter(items);
  if (gutter == null) return layoutColumn(items);
  const spanning = items.filter((it) => it.x < gutter && it.x + it.width > gutter + 4);
  const left = items.filter((it) => it.x + it.width <= gutter);
  const right = items.filter((it) => it.x >= gutter);
  return [layoutColumn(spanning), layoutColumn(left), layoutColumn(right)]
    .filter((part) => part.trim())
    .join("\n");
}

export function layoutPdfJsItems(items: PdfJsLike[]): string {
  return layoutPdfPage(pdfJsItems(items));
}

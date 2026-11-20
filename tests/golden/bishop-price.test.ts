/**
 * Bishop Distributing price list summary for The Floor King, effective 11/20/2026.
 * One price is the cost. Sheet vinyl uses the cut, and keeps the lower roll price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseBishopPriceList, type BishopTextItem } from "@/lib/bishop-price";
import type { PriceRow } from "@/lib/extract";

async function loadBook() {
  const data = new Uint8Array(
    readFileSync(join(process.cwd(), "tests/golden/fixtures/bishop-030835-pricelist-summary.pdf")),
  );
  const doc = await getDocument(Object.assign({ data }, { disableWorker: true })).promise;
  const pages: BishopTextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: BishopTextItem[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim() || !it.transform) continue;
      items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] });
    }
    pages.push(items);
  }
  const book = parseBishopPriceList(pages);
  if (!book) throw new Error("Bishop price list did not parse");
  return book;
}

function find(rows: PriceRow[], sku: string) {
  const row = rows.find((r) => r.sku === sku);
  if (!row) throw new Error(`missing ${sku}`);
  return row;
}

describe("Bishop price list", () => {
  it("reads every product once, with the sheet's cost", async () => {
    const book = await loadBook();
    expect(book.distributor).toBe("Bishop Distributing Co");
    expect(book.rows).toHaveLength(380);
    expect(new Set(book.rows.map((r) => r.name.toLowerCase())).size).toBe(380);
    expect(book.rows.every((r) => (r.material_rate ?? 0) > 0 && (r.material_rate ?? 0) < 200)).toBe(true);
    expect(book.rows.every((r) => r.color == null)).toBe(true);
    expect(book.rows.every((r) => Boolean(r.manufacturer))).toBe(true);

    const bella = find(book.rows, "JHFLBV");
    expect(bella).toMatchObject({
      name: "Bella Vista Laminate",
      category: "laminate",
      unit: "sqft",
      material_rate: 2.99,
      manufacturer: "Johnson Hardwood",
    });
    expect(bella.roll_rate ?? null).toBeNull();

    const sheet = find(book.rows, "CONAAD");
    expect(sheet).toMatchObject({
      category: "vinyl",
      unit: "sqyd",
      material_rate: 29.2,
      roll_rate: 25.03,
      manufacturer: "Congoleum",
    });

    const wood = find(book.rows, "MERA31");
    expect(wood).toMatchObject({
      category: "hardwood",
      unit: "sqft",
      material_rate: 8.2,
      manufacturer: "Mercier Wood Flooring",
    });
    expect(find(book.rows, "MERA48")).toMatchObject({
      name: "Design+ Red Oak Distinction Solid 3/4 X 4-1/4",
      material_rate: 8.8,
    });

    const tread = find(book.rows, "HCV080");
    expect(tread).toMatchObject({
      category: "lvp",
      unit: "box",
      material_rate: 59.99,
      manufacturer: "Homecrest",
    });
    expect(tread.notes).toContain("Priced per carton");

    const nose = find(book.rows, "COTXTF");
    expect(nose).toMatchObject({
      category: "trim",
      unit: "each",
      material_rate: 43.55,
      manufacturer: "Congoleum",
    });

    expect(parseBishopPriceList([[{ str: "Shaw", x: 10, y: 10 }]])).toBeNull();
  });
});

/**
 * PDF price lists must keep the product name together and the price in its
 * own column. A cut price is the carpet cost. A title line above the header
 * must not hide the sheet.
 */
import { describe, expect, it } from "vitest";
import { parseStructuredRows } from "@/lib/catalog-csv";
import { layoutPdfPage, type PdfTextItem } from "@/lib/pdf-layout";

function item(
  str: string,
  x: number,
  y: number,
  width: number,
  height = 10,
): PdfTextItem {
  return { str, x, y, width, height };
}

describe("PDF price layout", () => {
  it("keeps a style name together and tabs the price columns", () => {
    const text = layoutPdfPage([
      item("Style", 40, 720, 28),
      item("Name", 72, 720, 32),
      item("Color", 200, 720, 32),
      item("Cut", 340, 720, 22),
      item("Roll", 430, 720, 24),
      item("Shaw", 40, 700, 28),
      item("Annapolis", 72, 700.3, 58),
      item("Linen", 200, 699.6, 30),
      item("4", 340, 700, 8),
      item(".99", 347.2, 700, 18),
      item("3.25", 430, 700.2, 24),
    ]);
    expect(text).toContain("Style Name\tColor\tCut\tRoll");
    expect(text).toContain("Shaw Annapolis\tLinen\t4.99\t3.25");
    const rows = parseStructuredRows(text);
    expect(rows).toHaveLength(1);
    expect(rows?.[0].name).toBe("Shaw Annapolis Linen");
    expect(rows?.[0].category).toBe("carpet");
    expect(rows?.[0].unit).toBe("sqyd");
    expect(rows?.[0].material_rate).toBe(4.99);
    expect(rows?.[0].color).toBe("Linen");
  });

  it("reads a title and a repeated header without taking the roll price", () => {
    const rows = parseStructuredRows(
      [
        "Mohawk Dealer Price List",
        "Effective January 2026",
        "Style Name\tColor\tCut\tRoll",
        "Annapolis\tLinen\t4.99\t3.25",
        "Style Name\tColor\tCut\tRoll",
        "Annapolis\tNavy\t5.10\t3.40",
      ].join("\n"),
    );
    expect(rows?.map((row) => row.material_rate)).toEqual([4.99, 5.1]);
    expect(rows?.every((row) => row.category === "carpet" && row.unit === "sqyd")).toBe(true);
  });

  it("converts a carton price into the per-square-foot cost", () => {
    const rows = parseStructuredRows(
      ["Product\tCarton\tSq Ft Per Box", "Coretec Honey Oak\t45.62\t23.8"].join("\n"),
    );
    expect(rows?.[0].category).toBe("lvp");
    expect(rows?.[0].unit).toBe("sqft");
    expect(rows?.[0].material_rate).toBe(1.92);
    expect(rows?.[0].notes).toContain("23.8 sf/carton");
  });

  it("does not split a single table just because the price sits far to the right", () => {
    const rows: PdfTextItem[] = [];
    for (let n = 0; n < 6; n++) {
      const y = 700 - n * 16;
      rows.push(item(n === 0 ? "Style Name" : `Carpet ${n}`, 40, y, 90));
      rows.push(item(n === 0 ? "Cut" : `${n}.50`, 420, y, 28));
    }
    const text = layoutPdfPage(rows);
    expect(text.split("\n")[1]).toBe("Carpet 1\t1.50");
    expect(parseStructuredRows(text)?.[0].material_rate).toBe(1.5);
  });

  it("reads the left column of a page before the right column", () => {
    const rows: PdfTextItem[] = [];
    for (let n = 0; n < 4; n++) {
      const y = 700 - n * 16;
      rows.push(item(n === 0 ? "Style" : `Left ${n}`, 40, y, 70));
      rows.push(item(n === 0 ? "Cut" : `${n}.25`, 140, y, 28));
      rows.push(item(n === 0 ? "Style" : `Right ${n}`, 360, y, 70));
      rows.push(item(n === 0 ? "Cut" : `${n}.75`, 460, y, 28));
    }
    const text = layoutPdfPage(rows);
    const lines = text.split("\n");
    expect(lines.indexOf("Left 1\t1.25")).toBeGreaterThan(-1);
    expect(lines.indexOf("Left 1\t1.25")).toBeLessThan(lines.indexOf("Right 1\t1.75"));
    expect(lines.some((line) => line.includes("Left") && line.includes("Right"))).toBe(false);
    const parsed = parseStructuredRows(text);
    expect(parsed?.map((row) => row.material_rate)).toEqual([1.25, 2.25, 3.25, 1.75, 2.75, 3.75]);
  });
});

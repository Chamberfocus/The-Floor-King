/**
 * Ohio Valley Flooring price books for The Floor King.
 * Floor price is the cost. Trim is per piece. Commercial tables keep their own unit.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRow } from "@/app/(app)/catalog/smart-importer";
import { parseOvfWorkbook, type OvfSheet } from "@/lib/ovf-price";
import type { PriceRow } from "@/lib/extract";

async function load(name: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(readFileSync(join(process.cwd(), "tests/golden/fixtures", name)), {
    type: "buffer",
  });
  const sheets: OvfSheet[] = wb.SheetNames.map((sheet) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }) as unknown[][];
    return {
      name: sheet,
      rows: rows.map((r) =>
        (Array.isArray(r) ? r : []).map((c) => String(c ?? "").replace(/\s+/g, " ").trim()),
      ),
    };
  });
  const book = parseOvfWorkbook(sheets);
  if (!book) throw new Error(`${name} did not parse`);
  return book;
}

function find(rows: PriceRow[], sku: string) {
  const row = rows.find((r) => r.sku === sku);
  if (!row) throw new Error(`missing ${sku}`);
  return row;
}

function uniqueNames(rows: PriceRow[]) {
  expect(new Set(rows.map((r) => r.name.toLowerCase())).size).toBe(rows.length);
  expect(rows.every((r) => (r.material_rate ?? 0) > 0)).toBe(true);
  const flagged = rows
    .map((r) => ({ name: r.name, unit: r.unit, category: r.category, price: r.material_rate, reason: validateRow(r).reason }))
    .filter((r) => r.reason);
  expect(flagged.slice(0, 12)).toEqual([]);
}

describe("Ohio Valley price books", () => {
  it("reads Inhaus laminate, rigid core, and the matching trim", async () => {
    const book = await load("ovf-inhaus.xls");
    expect(book.distributor).toBe("Ohio Valley Flooring");
    uniqueNames(book.rows);
    expect(find(book.rows, "56146")).toMatchObject({
      name: "Inhaus Inspiration Laminate with PAD — Coldspring",
      category: "laminate",
      unit: "sqft",
      material_rate: 1.89,
      manufacturer: "Inhaus",
    });
    expect(find(book.rows, "QR116700")).toMatchObject({
      name: "Inhaus Inspiration Laminate with PAD — Coldspring — Quarter Round",
      category: "trim",
      unit: "each",
      material_rate: 17.09,
    });
    expect(find(book.rows, "56155").notes ?? "").toMatch(/Dropped/);
    expect(find(book.rows, "56138")).toMatchObject({ material_rate: 1.99, category: "laminate" });
    const ceramin = book.rows.find((r) => /ceramin/i.test(r.style ?? "") && r.unit === "sqft");
    expect(ceramin?.category).toBe("lvp");
    expect(ceramin?.material_rate).toBeGreaterThan(2);
  });

  it("reads Hallmark wood, the old item number, and the laminate and vinyl at the back", async () => {
    const book = await load("ovf-hallmark-wood.xls");
    uniqueNames(book.rows);
    const balboa = find(book.rows, "AV75OBALC");
    expect(balboa).toMatchObject({
      name: "Hallmark Alta Vista Collection — European White Oak — Balboa",
      category: "hardwood",
      unit: "sqft",
      material_rate: 7.49,
      manufacturer: "Hallmark",
    });
    expect(balboa.notes ?? "").toMatch(/AV75OBAL/);
    expect(find(book.rows, "ATC325NATRO-S")).toMatchObject({
      material_rate: 7.99,
      category: "hardwood",
    });
    expect(find(book.rows, "ATC5NATRO-S")).toMatchObject({ material_rate: 8.89 });
    expect(find(book.rows, "ATC325NATRO-S").name).not.toBe(find(book.rows, "ATC5NATRO-S").name);
    expect(find(book.rows, "CRE968ALLO")).toMatchObject({
      category: "laminate",
      material_rate: 2.69,
    });
    expect(find(book.rows, "COADM9O5MM-19")).toMatchObject({
      category: "lvp",
      material_rate: 3.79,
    });
    expect(find(book.rows, "COCLY9M5MM")).toMatchObject({ material_rate: 3.69 });
  });

  it("reads Quick-Step by the square foot and prices trim by the piece", async () => {
    const book = await load("ovf-quick-step.xls");
    uniqueNames(book.rows);
    expect(find(book.rows, "NEUP20")).toMatchObject({
      name: "Quick-Step ESSENTIALS Collection — Clay",
      category: "laminate",
      unit: "sqft",
      material_rate: 2.29,
      manufacturer: "Quick-Step",
    });
    expect(find(book.rows, "NEUP20").notes ?? "").toMatch(/50\.59/);
    expect(find(book.rows, "DQND06666")).toMatchObject({
      category: "trim",
      unit: "each",
      material_rate: 7.49,
    });
    expect(book.rows.filter((r) => r.sku === "NEUP20")).toHaveLength(1);
    const hardwood = book.rows.find((r) => /centoria/i.test(r.style ?? "") && r.unit === "sqft");
    expect(hardwood).toMatchObject({ category: "hardwood", material_rate: 3.79 });
  });

  it("reads Schönox by the container and skips a price of N/A", async () => {
    const book = await load("ovf-schonox.xls");
    const copy = await load("ovf-schonox-copy.xls");
    uniqueNames(book.rows);
    expect(copy.rows.map((r) => `${r.sku}|${r.material_rate}`)).toEqual(
      book.rows.map((r) => `${r.sku}|${r.material_rate}`),
    );
    expect(find(book.rows, "HFP33P")).toMatchObject({
      name: "Schönox FP — 33# BAG",
      category: "underlayment",
      unit: "bag",
      material_rate: 77.99,
      manufacturer: "Schönox",
    });
    expect(find(book.rows, "HSHP1P").material_rate).toBe(79.99);
    expect(find(book.rows, "HSHP244P").material_rate).toBe(169.79);
    expect(find(book.rows, "HGMBCC15T").material_rate).toBe(582.59);
    expect(book.rows.some((r) => r.sku === "HH20T")).toBe(false);
  });

  it("reads each Mirage color at the grade price for that width", async () => {
    const book = await load("ovf-mirage-value-tower.xls");
    uniqueNames(book.rows);
    expect(find(book.rows, "75986")).toMatchObject({
      name: "Mirage Muse Character — Ada — TruBalance 3/4\" 5\"",
      category: "hardwood",
      unit: "sqft",
      material_rate: 10.49,
      manufacturer: "Mirage",
    });
    expect(find(book.rows, "72697").material_rate).toBe(10.49);
    expect(find(book.rows, "75988").material_rate).toBe(11.99);
    expect(find(book.rows, "50419")).toMatchObject({
      material_rate: 8.69,
      name: "Mirage DreamVille Character — Aspen — TruBalance 3/4\" 5\"",
    });
    expect(find(book.rows, "75088")).toMatchObject({
      material_rate: 5.19,
      color: "Blue Ridge",
    });
    expect(find(book.rows, "75088").notes ?? "").toMatch(/February 3, 2025/);
    expect(new Set(book.rows.map((r) => r.sku)).size).toBe(book.rows.length);
  });

  it("reads Tarkett commercial colors at the table price and keeps the printed unit", async () => {
    const book = await load("ovf-tarkett-commercial.xls");
    uniqueNames(book.rows);
    expect(book.rows.some((r) => /X{3,}/.test(r.sku ?? ""))).toBe(false);
    expect(find(book.rows, "350002323")).toMatchObject({
      name: "Tarkett Standard VCT II — Starry Night",
      category: "tile",
      unit: "box",
      material_rate: 69.19,
      manufacturer: "Tarkett",
    });
    expect(find(book.rows, "350002600").material_rate).toBe(97.95);
    expect(find(book.rows, "350002873")).toMatchObject({ material_rate: 246.29, unit: "box" });
    const afterglow = find(book.rows, "251176052");
    expect(afterglow).toMatchObject({ material_rate: 2.65, unit: "sqft", category: "lvp" });
    expect(afterglow.name).toMatch(/Afterglow/);
    expect(afterglow.name).toMatch(/18x18/);
    expect(find(book.rows, "500033006")).toMatchObject({
      material_rate: 0.72,
      unit: "sqft",
      category: "underlayment",
    });
    expect(find(book.rows, "3242205")).toMatchObject({
      name: "Tarkett iQ Optima — Soft Warm White",
      category: "vinyl",
      unit: "sqyd",
      material_rate: 46.15,
    });
    expect(find(book.rows, "314013205")).toMatchObject({
      material_rate: 7.09,
      unit: "sqft",
      color: "Soft Warm White",
    });
    const base = book.rows.find((r) => r.material_rate === 0.66 && r.unit === "lnft");
    expect(base?.category).toBe("trim");
    const ledges = book.rows.filter((r) => r.sku === "MW XX X62");
    expect(ledges.map((r) => r.material_rate).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([5.79, 11.69]);
    expect(ledges.every((r) => r.unit === "lnft" && r.category === "trim")).toBe(true);
    expect(ledges.some((r) => /Millwork Wall Base/.test(r.name))).toBe(true);
    expect(ledges.some((r) => /Masquerade/.test(r.name))).toBe(true);
    const reducer = book.rows.find((r) => r.sku === "RIR-40-E");
    expect(reducer).toMatchObject({ material_rate: 28.25, unit: "lnft", category: "trim" });
  });

  it("leaves an ordinary spreadsheet for the column mapper", () => {
    expect(
      parseOvfWorkbook([
        { name: "Prices", rows: [["Item", "Cost"], ["Pad", "1.25"]] },
      ]),
    ).toBeNull();
  });

  it("holds a square-foot price over $200 and keeps a real box price", () => {
    expect(
      validateRow({
        name: "Misread roll",
        category: "tile",
        unit: "sqft",
        sku: null,
        material_rate: 246,
        labor_rate: null,
        notes: null,
      }).level,
    ).toBe("flag");
    expect(
      validateRow({
        name: "Premium VCT carton",
        category: "tile",
        unit: "box",
        sku: "350002873",
        material_rate: 246.29,
        labor_rate: null,
        notes: null,
      }).level,
    ).toBe("ok");
  });
});

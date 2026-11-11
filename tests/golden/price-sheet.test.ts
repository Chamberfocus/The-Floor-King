import { describe, expect, it } from "vitest";
import {
  applySheetFacts,
  parsePriceSheet,
  pdfItemsToLines,
  priceSheetProductName,
  readPriceText,
  sheetLinesToPriceRows,
} from "@/lib/price-sheet";
import { buildCatalogTemplate } from "@/lib/catalog-csv";
import { parseStructuredRows } from "@/lib/catalog-csv";

describe("price sheet", () => {
  it("reads style, color, cut, and roll, and ignores the rest of the page", () => {
    const text = [
      "Shaw Floors Dealer Price List",
      "Effective January 1, 2026",
      "Page 1 of 4",
      "Style Name\tStyle #\tColor\tColor #\tCut\tRoll\tRetail",
      "EverStrand\t5T43\tSeagull\t515\t18.95\t16.40\t32.00",
      "EverStrand\t5T43\tLinen\t00712\t$18.95\t$16.40\t$32.00",
      "Freight is prepaid on roll orders",
      "Page 2 of 4",
      "Style Name\tStyle #\tColor\tColor #\tCut\tRoll\tRetail",
      "\t\tNatural Weave\t880\t19.10\t16.55\t33.00",
    ].join("\n");
    const rows = parsePriceSheet(text);
    expect(rows).toHaveLength(3);
    expect(rows?.[0]).toMatchObject({
      style: "EverStrand",
      styleNumber: "5T43",
      color: "Seagull",
      colorNumber: "515",
      cutPrice: 18.95,
      rollPrice: 16.4,
    });
    expect(rows?.[1].color).toBe("Linen");
    expect(rows?.[1].colorNumber).toBe("00712");
    expect(rows?.[2].style).toBe("EverStrand");
    expect(rows?.[2].color).toBe("Natural Weave");
    expect(rows?.[2].cutPrice).toBe(19.1);
    expect(rows?.[2].rollPrice).toBe(16.55);

    const priced = sheetLinesToPriceRows(rows ?? []);
    expect(priced[0].name).toBe("EverStrand — Seagull");
    expect(priced[0].sku).toBe("5T43");
    expect(priced[0].material_rate).toBe(18.95);
    expect(priced[0].roll_rate).toBe(16.4);
    expect(priced[0].color).toBe("Seagull");
    expect(priced[0].notes).toContain("Color # 515");
    expect(priced[0].manufacturer).toBeNull();
    expect(priced[1].notes).toContain("Color # 00712");
  });

  it("keeps a style printed once above its colors", () => {
    const text = [
      "Style: SmartStrand Silk",
      "Style #: 5T99",
      "Color\tColor #\tCut Price\tRoll Price",
      "Linen\t00712\t21.00\t18.25",
      "Seagull\t515\t21.00\t18.25",
    ].join("\n");
    const rows = parsePriceSheet(text);
    expect(rows).toHaveLength(2);
    expect(rows?.every((r) => r.style === "SmartStrand Silk" && r.styleNumber === "5T99")).toBe(
      true,
    );
    expect(rows?.[0].rollPrice).toBe(18.25);
  });

  it("uses the only price as the cut price when there is no roll column", () => {
    const text = ["Style\tColor\tYour Cost", "Coretec\tHoney Oak\t3.50"].join("\n");
    const rows = parsePriceSheet(text);
    expect(rows).toEqual([
      {
        style: "Coretec",
        color: "Honey Oak",
        styleNumber: null,
        colorNumber: null,
        cutPrice: 3.5,
        rollPrice: null,
      },
    ]);
  });

  it("does not invent rows from a page that is not a color price sheet", () => {
    expect(parsePriceSheet("Freight terms\nPage 2\nCall for pricing")).toBeNull();
    expect(parsePriceSheet("Style\tColor\tList Price\nEverStrand\tLinen\t40.00")).toBeNull();
  });

  it("turns PDF text positions into columns", () => {
    const lines = pdfItemsToLines([
      { str: "Style", x: 40, y: 700, width: 28, height: 10 },
      { str: "Color", x: 180, y: 701, width: 30, height: 10 },
      { str: "Cut", x: 320, y: 700, width: 18, height: 10 },
      { str: "Roll", x: 400, y: 699, width: 22, height: 10 },
      { str: "EverStrand", x: 40, y: 680, width: 62, height: 10 },
      { str: "Seagull", x: 180, y: 680, width: 42, height: 10 },
      { str: "18.95", x: 320, y: 680, width: 28, height: 10 },
      { str: "16.40", x: 400, y: 680, width: 28, height: 10 },
    ]);
    expect(lines[0]).toBe("Style\tColor\tCut\tRoll");
    expect(parsePriceSheet(lines.join("\n"))?.[0]).toMatchObject({
      style: "EverStrand",
      color: "Seagull",
      cutPrice: 18.95,
      rollPrice: 16.4,
    });
  });

  it("stamps manufacturer, distributor answers, and one note onto every color", () => {
    const rows = sheetLinesToPriceRows(
      parsePriceSheet(["Style\tColor\tCut\tRoll", "EverStrand\tSeagull\t18.95\t16.40"].join("\n")) ??
        [],
    );
    const stamped = applySheetFacts(
      rows,
      {
        manufacturer: "Mohawk",
        distributor: "E.J. Welch",
        category: "carpet",
        unit: "sqyd",
        note: "12 ft",
      },
      { lockCategory: true },
    );
    expect(stamped[0].manufacturer).toBe("Mohawk");
    expect(stamped[0].category).toBe("carpet");
    expect(stamped[0].unit).toBe("sqyd");
    expect(stamped[0].notes).toBe("12 ft");
    const again = applySheetFacts(
      stamped,
      {
        manufacturer: "Mohawk",
        distributor: "E.J. Welch",
        category: "carpet",
        unit: "sqyd",
        note: "12 ft",
      },
      { lockCategory: true },
    );
    expect(again[0].notes).toBe("12 ft");
    expect(priceSheetProductName("EverStrand", "Seagull")).toBe("EverStrand — Seagull");
  });

  it("keeps cut and roll when the sheet has extra columns and a style printed once", () => {
    const text = [
      "Mohawk Dealer Price List",
      "Page 1 of 2",
      "Style\tColor\tWidth\tFiber\tCut\tRoll\tRetail",
      "EverStrand",
      "\tSeagull\t12\tNylon\t18.95\t16.40\t40.00",
      "SmartStrand",
      "\tLinen\t12\tTriexta\t21.00\t18.25\t44.00",
    ].join("\n");
    const read = readPriceText(text);
    expect(read?.sheet).toBe(true);
    expect(read?.rows).toHaveLength(2);
    expect(read?.rows[0]).toMatchObject({
      style: "EverStrand",
      color: "Seagull",
      material_rate: 18.95,
      roll_rate: 16.4,
      manufacturer: null,
    });
    expect(read?.rows[1]).toMatchObject({
      style: "SmartStrand",
      color: "Linen",
      material_rate: 21,
      roll_rate: 18.25,
    });
    expect(read?.rows[0].notes ?? "").not.toMatch(/nylon|retail|width/i);
  });

  it("leaves a spreadsheet that already has categories on the spreadsheet path", () => {
    const read = readPriceText(buildCatalogTemplate());
    expect(read?.sheet).toBe(false);
    expect(read?.rows[0].category).toBe("lvp");
    expect(read?.rows[0].material_rate).toBe(3.5);
  });

  it("aligns a blank style cell to the style column", () => {
    const lines = pdfItemsToLines([
      { str: "Style", x: 40, y: 700, width: 28, height: 10 },
      { str: "Color", x: 180, y: 700, width: 30, height: 10 },
      { str: "Cut", x: 320, y: 700, width: 18, height: 10 },
      { str: "Roll", x: 420, y: 700, width: 22, height: 10 },
      { str: "EverStrand", x: 40, y: 680, width: 62, height: 10 },
      { str: "Seagull", x: 180, y: 680, width: 42, height: 10 },
      { str: "18.95", x: 320, y: 680, width: 28, height: 10 },
      { str: "16.40", x: 420, y: 680, width: 28, height: 10 },
      { str: "Linen", x: 180, y: 660, width: 32, height: 10 },
      { str: "19.10", x: 320, y: 660, width: 28, height: 10 },
      { str: "16.55", x: 420, y: 660, width: 28, height: 10 },
    ]);
    const rows = parsePriceSheet(lines.join("\n"));
    expect(rows?.[1]).toMatchObject({
      style: "EverStrand",
      color: "Linen",
      cutPrice: 19.1,
      rollPrice: 16.55,
    });
  });

  it("reads a style price list whose roll price sits left of the cut price", () => {
    const text = [
      "STYLE\tROLL\tCUT",
      "CODE STYLE DESCRIPTION\tSIZE\tBACK\tPRICE\tPRICE UM",
      "33165 AMBITION\t1200\tAB\t$15.09\t$16.09 SY",
      "33299 BUCKINGHAM III\t1200\tAB\t$13.39\t$14.39 SY",
      "33141 CHEER UP\t1200\tAB\t$12.59\t$13.59 SY",
      "33125 DIAMONDS ARE FOREVER 1200\tAB\t$15.89\t$16.89 SY",
      "33086 DIVINE WIND\t1200\tGS\t$23.49\t$24.49 SY",
      "Thank you for business, if you have any questions regarding this price",
    ].join("\n");
    const read = readPriceText(text);
    expect(read?.sheet).toBe(true);
    expect(read?.rows.map((row) => ({
      name: row.name,
      sku: row.sku,
      style: row.style,
      color: row.color,
      material_rate: row.material_rate,
      roll_rate: row.roll_rate,
    }))).toEqual([
      {
        name: "AMBITION",
        sku: "33165",
        style: "AMBITION",
        color: null,
        material_rate: 16.09,
        roll_rate: 15.09,
      },
      {
        name: "BUCKINGHAM III",
        sku: "33299",
        style: "BUCKINGHAM III",
        color: null,
        material_rate: 14.39,
        roll_rate: 13.39,
      },
      {
        name: "CHEER UP",
        sku: "33141",
        style: "CHEER UP",
        color: null,
        material_rate: 13.59,
        roll_rate: 12.59,
      },
      {
        name: "DIAMONDS ARE FOREVER",
        sku: "33125",
        style: "DIAMONDS ARE FOREVER",
        color: null,
        material_rate: 16.89,
        roll_rate: 15.89,
      },
      {
        name: "DIVINE WIND",
        sku: "33086",
        style: "DIVINE WIND",
        color: null,
        material_rate: 24.49,
        roll_rate: 23.49,
      },
    ]);
    expect(read?.rows.every((row) => row.manufacturer == null)).toBe(true);
  });

  it("keeps the roll price on a normal spreadsheet row", () => {
    const rows = parseStructuredRows(
      ["Style Name,Color,Cut,Roll,Your Cost", "EverStrand,Seagull,18.95,16.40,18.95"].join("\n"),
    );
    expect(rows?.[0].material_rate).toBe(18.95);
    expect(rows?.[0].roll_rate).toBe(16.4);
    expect(rows?.[0].style).toBe("EverStrand");
    expect(rows?.[0].color).toBe("Seagull");
  });
});

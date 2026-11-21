/**
 * LW Flooring AM price list, effective 11/2/2026.
 * The Price column is the printed cost. Coming soon rows keep that price.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { pdfJsItems } from "@/lib/pdf-layout";
import { parseLwFlooringPriceList } from "@/lib/lw-flooring-price";
import { parsePdHappyFeetPriceList } from "@/lib/pd-happy-feet-price";
import { parseSomersetPriceList } from "@/lib/somerset-price";
import type { PriceRow } from "@/lib/extract";

async function pages(file: string) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    out.push(
      pdfJsItems(
        content.items as {
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        }[],
      ),
    );
  }
  return out;
}

function find(rows: PriceRow[], sku: string) {
  const found = rows.filter((row) => row.sku === sku);
  if (found.length !== 1) throw new Error(`${sku} matched ${found.length}`);
  return found[0]!;
}

const lwPages = await pages(join(process.cwd(), "tests/golden/fixtures/lw-flooring-am-2026-11-02.pdf"));
const book = parseLwFlooringPriceList(lwPages);

describe("LW Flooring AM", () => {
  const rows = book?.rows ?? [];

  it("prices each color from the printed Price column", () => {
    expect(book?.distributor).toBe("LW Flooring");
    expect(rows).toHaveLength(288);

    const alimia = find(rows, "PIWO15A10");
    expect(alimia.name).toBe("LW Flooring European White Oak Alimia");
    expect(alimia.category).toBe("hardwood");
    expect(alimia.unit).toBe("sqft");
    expect(alimia.material_rate).toBe(6.89);

    expect(find(rows, "HBPIWO15C6").name).toContain("Herringbone");
    expect(find(rows, "HBPIWO15C6").material_rate).toBe(7.89);
    const bermuda = find(rows, "SGPIWO15BE10");
    expect(bermuda.material_rate).toBe(10.09);
    expect(bermuda.notes).toContain("Coming soon");
    expect(find(rows, "PCWO14C7").material_rate).toBe(7.09);
    expect(find(rows, "VEAH15A7").material_rate).toBe(6.09);
    expect(find(rows, "VEWO15E7").material_rate).toBe(6.09);
    expect(find(rows, "RCWO14AV7").material_rate).toBe(5.49);
    expect(find(rows, "SVAH12H7").material_rate).toBe(4.29);
    expect(find(rows, "SVAH12T7C").material_rate).toBe(4.89);
    expect(find(rows, "SVAH12A37C").material_rate).toBe(5.69);
    expect(find(rows, "SVAW12P7").material_rate).toBe(6.09);
    expect(find(rows, "SVWO12MA7P").name).toContain("Madeira (Natural)");
    expect(find(rows, "SVWO12MA7P").material_rate).toBe(4.19);
    expect(find(rows, "FIWO10AN7").material_rate).toBe(3.39);
    expect(find(rows, "HSAC10D5").material_rate).toBe(3.89);
    expect(find(rows, "HSAH10B5").material_rate).toBe(2.89);
    expect(find(rows, "TCAH12CC7").material_rate).toBe(3.99);
    expect(find(rows, "TCWO10L5").material_rate).toBe(2.79);

    expect(find(rows, "GC12CB9").material_rate).toBe(3.69);
    expect(find(rows, "GC12CB9").category).toBe("lvp");
    expect(find(rows, "GC12KO9").notes).toContain("Coming soon");
    expect(find(rows, "EVP7AN9").name).toContain("7.8mm");
    expect(find(rows, "EVP7GO9").name).toContain("8mm");
    expect(find(rows, "EVP7MA9").material_rate).toBe(3.09);
    expect(find(rows, "SPC5AT7").material_rate).toBe(2.29);
    expect(find(rows, "SPC5TE7").material_rate).toBe(2.29);
    expect(find(rows, "SPC4BA7").material_rate).toBe(1.99);

    expect(find(rows, "LMO14AL9").category).toBe("laminate");
    expect(find(rows, "LMO14AL9").material_rate).toBe(2.89);
    expect(find(rows, "LMO14TE9").notes).toContain("Coming soon");
    expect(find(rows, "LOD12WI7").material_rate).toBe(2.59);
    expect(find(rows, "LCA10AB7").material_rate).toBe(2.09);

    expect(find(rows, "TS2GE7").material_rate).toBe(0.83);
    expect(find(rows, "SC5DU9").material_rate).toBe(2.39);
    expect(find(rows, "ML2GP9").name).toContain("Gramercy Park");
    expect(find(rows, "ML2GP9").material_rate).toBe(1.39);
    expect(find(rows, "UA2ME9").material_rate).toBe(1.09);

    expect(rows.every((row) => row.manufacturer === "LW Flooring")).toBe(true);
    expect(rows.every((row) => (row.material_rate ?? 0) > 0)).toBe(true);
    expect(new Set(rows.map((row) => row.name.toLowerCase())).size).toBe(rows.length);
  });

  it("prices moldings, treads, adhesives, and underlayment by the piece", () => {
    const round = rows.find((row) => row.name === 'LW Flooring Acacia Quarter Round 72" long');
    expect(round?.material_rate).toBe(32);
    expect(round?.unit).toBe("each");
    expect(round?.category).toBe("trim");
    expect(round?.notes).toContain("Custom Order");
    expect(rows.find((row) => row.name === 'LW Flooring Wood Stairnose 78" long')?.material_rate).toBe(69);

    const oak = rows.find((row) => row.name === "LW Flooring Stair Tread No Return White Oak 60\"");
    expect(oak?.material_rate).toBe(169.5);
    expect(oak?.notes).toContain("Add $4.00 for Brushing/Distressing");
    expect(oak?.notes).toContain("Add $8.00 for Handscraping");
    expect(rows.find((row) => row.name === "LW Flooring Stair Tread No Return Red Oak 42\"")?.material_rate).toBe(101.5);
    expect(rows.find((row) => row.name === "LW Flooring Stair Tread With Return Hickory 60\"")?.material_rate).toBe(187);
    const dbl = rows.find((row) => row.name === "LW Flooring Stair Tread With Double Return Maple 48\"");
    expect(dbl?.material_rate).toBe(187);
    expect(dbl?.notes).toContain("3-4 week leadtime");
    const riser = rows.find((row) => row.name === "LW Flooring Riser Hickory 60\"");
    expect(riser?.material_rate).toBe(173);
    expect(riser?.notes ?? "").not.toContain("Handscraping");
    expect(rows.find((row) => row.name === "LW Flooring Riser Primed 42\"")?.material_rate).toBe(16.5);

    expect(find(rows, "BOADW4").material_rate).toBe(98);
    expect(find(rows, "BOADW4").unit).toBe("each");
    expect(find(rows, "BOADGF4").material_rate).toBe(176);
    const roll = find(rows, "FMEN100");
    expect(roll.category).toBe("underlayment");
    expect(roll.material_rate).toBe(41);
    expect(roll.unit).toBe("each");

    const noses = rows.filter((row) => row.name.includes("Flush Stairnosing"));
    expect(noses.map((row) => row.material_rate)).toEqual([45, 45, 45, 45, 45]);
    expect(new Set(noses.map((row) => row.name)).size).toBe(5);
  });

  it("does not read another Palmer Donavin book", async () => {
    const somerset = await pages(join(process.cwd(), "tests/golden/fixtures/somerset-r35-2026-10-29.pdf"));
    const happy = await pages(join(process.cwd(), "tests/golden/fixtures/pd-r35-happy-feet-2026-09-04.pdf"));
    expect(parseLwFlooringPriceList(somerset)).toBeNull();
    expect(parseLwFlooringPriceList(happy)).toBeNull();
    expect(parseSomersetPriceList(lwPages)).toBeNull();
    expect(parsePdHappyFeetPriceList(lwPages)).toBeNull();
  });
});

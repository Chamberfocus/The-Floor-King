/**
 * Palmer Donavin price books dropped on Price book → Import.
 * Happy Feet R3.5 effective 9/4/2026. Somerset R35 dated 10/29/2026.
 * Carton and $/SF figures are the printed costs. Call and TBD are not prices.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { pdfJsItems } from "@/lib/pdf-layout";
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

const happyPages = await pages(
  join(process.cwd(), "tests/golden/fixtures/pd-r35-happy-feet-2026-09-04.pdf"),
);
const somersetPages = await pages(
  join(process.cwd(), "tests/golden/fixtures/somerset-r35-2026-10-29.pdf"),
);
const happyFeet = parsePdHappyFeetPriceList(happyPages);
const somerset = parseSomersetPriceList(somersetPages);

describe("Palmer Donavin books stay on their own parser", () => {
  it("does not read one sheet as the other", () => {
    expect(parseSomersetPriceList(happyPages)).toBeNull();
    expect(parsePdHappyFeetPriceList(somersetPages)).toBeNull();
  });
});

describe("Happy Feet R3.5", () => {
  const book = happyFeet;

  it("prices stock colors at the collection carton price per square foot", () => {
    expect(book?.distributor).toBe("Palmer Donavin");
    const rows = book?.rows ?? [];
    const foxwood = find(rows, "HF752V");
    expect(foxwood.name).toBe("Happy Feet Quick Fit Foxwood");
    expect(foxwood.category).toBe("lvp");
    expect(foxwood.unit).toBe("sqft");
    expect(foxwood.material_rate).toBe(2.95);
    expect(foxwood.color).toBe("Foxwood");

    expect(find(rows, "HF1500").material_rate).toBe(3.39);
    expect(find(rows, "HF1500").style).toBe("Quarry Tile");
    expect(find(rows, "WD2014").material_rate).toBe(4.99);
    expect(find(rows, "WD2014").category).toBe("hardwood");
    expect(find(rows, "HF945").material_rate).toBe(2.89);
    expect(find(rows, "DL1100").material_rate).toBe(1.99);
    expect(find(rows, "HF776A").material_rate).toBe(3.29);
    expect(find(rows, "HF570").material_rate).toBe(1.97);
    const hf490 = rows.filter((row) => row.sku === "HF490");
    expect(hf490.map((row) => `${row.style} ${row.color}`).sort()).toEqual([
      "Mustang Sawtooth Grey",
      "Regency Sandy Bay",
    ]);
    expect(hf490.every((row) => row.material_rate === (row.style === "Mustang" ? 1.69 : 2.89))).toBe(true);
    expect(find(rows, "HF560").material_rate).toBe(1.49);
    expect(find(rows, "HF1004").style).toBe("Rescue");
    expect(find(rows, "HF458A").material_rate).toBe(2.65);
    expect(find(rows, "HF1664W").style).toBe("Urban Design Clic");
    expect(find(rows, "HF1664W").material_rate).toBe(2.09);
    expect(find(rows, "HF1207M").material_rate).toBe(3.99);
    expect(find(rows, "HF637").name).toBe("Happy Feet Titan Ashwood");
    expect(find(rows, "HF637").material_rate).toBe(1.89);

    const colors = rows.filter((row) => row.color && (row.category === "lvp" || row.category === "hardwood"));
    expect(colors).toHaveLength(85);
    expect(colors.every((row) => (row.material_rate ?? 0) > 0 && (row.material_rate ?? 0) < 20)).toBe(true);
  });

  it("keeps a non-stock collection as one product and prices accessories by the piece", () => {
    const rows = book?.rows ?? [];
    const arrival = rows.find((row) => row.name === "Happy Feet Arrival 10");
    expect(arrival?.category).toBe("laminate");
    expect(arrival?.unit).toBe("sqft");
    expect(arrival?.material_rate).toBe(1.99);
    expect(arrival?.color ?? null).toBeNull();

    const stair = rows.find((row) => row.name === "Happy Feet Laminate and Vinyl Flush Stair Cap");
    expect(stair?.category).toBe("trim");
    expect(stair?.unit).toBe("each");
    expect(stair?.material_rate).toBe(81.25);
    const hardwoodNose = rows.find((row) => row.name === "Happy Feet Hardwood Stair Nose");
    expect(hardwoodNose?.material_rate).toBe(49);

    const gallon = find(rows, "HF9100-1");
    expect(gallon.material_rate).toBe(40.21);
    expect(gallon.unit).toBe("each");
    expect(find(rows, "HF9100").material_rate).toBe(131.73);
    const primer = rows.filter((row) => row.sku === "HF525Z");
    expect(primer.map((row) => row.material_rate).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      55.47, 122.03,
    ]);
    expect(find(rows, "889608").category).toBe("underlayment");
    expect(find(rows, "889608").material_rate).toBe(25.67);
    expect(find(rows, "940007").material_rate).toBe(18.36);
  });
});

describe("Somerset R35", () => {
  const book = somerset;

  it("applies one width price to every color, and a bottom-row price only to that color", () => {
    expect(book?.distributor).toBe("Palmer Donavin");
    const rows = book?.rows ?? [];
    expect(find(rows, "CP314DWBLG").material_rate).toBe(5.41);
    expect(find(rows, "CP314LNBLG").material_rate).toBe(5.41);
    expect(find(rows, "CP41LNBLG").material_rate).toBe(6.04);
    expect(find(rows, "CP51LNBLG").material_rate).toBe(7.45);
    expect(find(rows, "EP314LNELG").material_rate).toBe(6.17);
    expect(find(rows, "EP512LNELG").material_rate).toBe(6.55);
    expect(find(rows, "CP314DWBLG").unit).toBe("sqft");
    expect(find(rows, "CP314DWBLG").category).toBe("hardwood");
    expect(find(rows, "CP314DWBLG").name).toContain("Solid");
    expect(find(rows, "EP314LNELG").name).toContain("Engineered");
    expect(find(rows, "TO8301").name).toContain("Solid");
    expect(find(rows, "EPTO8506E").name).toContain("Engineered");

    expect(find(rows, "CL2109").material_rate).toBe(4.35);
    expect(find(rows, "CL2110").material_rate).toBe(4.35);
    expect(find(rows, "EP512CLMYE").material_rate).toBe(5.79);

    expect(find(rows, "CL51DFB").material_rate).toBe(5.53);
    expect(find(rows, "EPCR51WOE").material_rate).toBe(6.04);

    expect(find(rows, "PS2103").material_rate).toBe(4.41);
    expect(find(rows, "PS2101").material_rate).toBe(4.41);
    expect(find(rows, "PS2117").material_rate).toBe(4.84);
    expect(find(rows, "PS31417").material_rate).toBe(5.33);

    expect(find(rows, "PP41GOB").material_rate).toBe(5.15);
    expect(find(rows, "EP512GOE").material_rate).toBe(5.92);
    expect(find(rows, "PP41WOB").material_rate).toBe(5.92);
    expect(find(rows, "EP512CPWOE").material_rate).toBe(6.17);

    expect(find(rows, "EP8LCNAE").material_rate).toBe(6.94);
    expect(find(rows, "EP8LCSDE").material_rate).toBe(6.94);
    expect(find(rows, "EP8HCBKE").material_rate).toBe(6.3);
    expect(find(rows, "EP8HCWNE").material_rate).toBe(6.3);

    expect(find(rows, "EPHCAB6E").material_rate).toBe(8.85);
    expect(find(rows, "EPHCAB6E").name).toContain('6"');
    expect(find(rows, "EPHCABRLE").material_rate).toBe(7.96);
    expect(find(rows, "EPHCABRLE").name).toContain("Random");
    expect(find(rows, "EPHCRB7E").material_rate).toBe(7.83);
    expect(find(rows, "EPHCRB7E").name).toContain('7"');
    expect(find(rows, "EPHCRARLE").material_rate).toBe(7.19);
    expect(find(rows, "EPHCVORLE").material_rate).toBe(7.19);

    expect(find(rows, "PS2603HG").material_rate).toBe(4.52);
    expect(find(rows, "PS2601HG").material_rate).toBe(4.52);
    expect(find(rows, "PS2606HG").material_rate).toBe(4.84);
    expect(find(rows, "PS2703B").material_rate).toBe(4.35);
    expect(find(rows, "PS2706B").material_rate).toBe(4.6);

    expect(rows.some((row) => row.sku === "EP7CURSS")).toBe(false);
    expect(find(rows, "EPWWON7E").material_rate).toBe(7.06);
    expect(find(rows, "EPWHSA6E").material_rate).toBe(6.94);
    expect(find(rows, "EPWHTO6E").material_rate).toBe(6.94);
    expect(find(rows, "TO8303").material_rate).toBe(4.03);
    expect(find(rows, "TO8301").material_rate).toBe(4.03);
    expect(find(rows, "TO8306").material_rate).toBe(4.16);
    expect(find(rows, "EPTO8506E").material_rate).toBe(5.52);
    expect(rows.some((row) => row.sku === "EPTO8706E")).toBe(false);
  });

  it("prices moldings from the column header and keeps a second price when the sheet prints one", () => {
    const rows = book?.rows ?? [];
    expect(find(rows, "ATU25").material_rate).toBe(35.7);
    expect(find(rows, "ATU25").category).toBe("other");
    expect(find(rows, "MQR84LG").material_rate).toBe(34);
    expect(find(rows, "MQR84LG").category).toBe("trim");
    expect(find(rows, "MSN3484LG").material_rate).toBe(57.8);
    expect(find(rows, "MQR01").material_rate).toBe(32.3);
    expect(rows.filter((row) => row.sku === "MQR01")).toHaveLength(1);
    const wide = rows.find((row) => row.sku === "MQR06" && row.name.includes("Wide Plank"));
    const classicRound = rows.find((row) => row.sku === "MQR06" && !row.name.includes("Wide Plank"));
    expect(classicRound?.material_rate).toBe(32.3);
    expect(wide?.material_rate).toBe(34);
    expect(rows.every((row) => (row.material_rate ?? 0) > 0)).toBe(true);
    expect(rows.every((row) => row.manufacturer === "Somerset")).toBe(true);
  });
});

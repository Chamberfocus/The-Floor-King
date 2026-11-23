/**
 * All Surfaces RL price lists.
 * The printed Price / Price per SF / Price per SY is the cost.
 * Molding columns are each. Congoleum's Retail column is the RL price,
 * and the lower Display price stays in the notes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDocumentProxy } from "unpdf";
import { parseAllSurfacesRlPriceList, type RlTextItem } from "@/lib/all-surfaces-rl-price";
import { parseBishopPriceList } from "@/lib/bishop-price";
import { parseLwFlooringPriceList } from "@/lib/lw-flooring-price";
import { pdfJsItems } from "@/lib/pdf-layout";
import type { PriceRow } from "@/lib/extract";

async function pages(file: string): Promise<RlTextItem[][]> {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const out: RlTextItem[][] = [];
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
      ).map((it) => ({ str: it.str, x: it.x, y: it.y })),
    );
  }
  return out;
}

function find(rows: PriceRow[], sku: string) {
  const found = rows.filter((row) => row.sku === sku);
  if (found.length !== 1) throw new Error(`${sku} matched ${found.length}`);
  return found[0]!;
}

function findName(rows: PriceRow[], name: string) {
  const found = rows.filter((row) => row.name === name);
  if (found.length !== 1) throw new Error(`${name} matched ${found.length}`);
  return found[0]!;
}

const aquaPages = await pages(join(process.cwd(), "tests/golden/fixtures/aquaproof-rl-2026-10-15.pdf"));
const casaPages = await pages(join(process.cwd(), "tests/golden/fixtures/casabella-firmfit-rl-2026-03-02.pdf"));
const congoPages = await pages(join(process.cwd(), "tests/golden/fixtures/congoleum-triversa-prime-rl-2025-10-15.pdf"));
const contractPages = await pages(join(process.cwd(), "tests/golden/fixtures/contract-180-rl-2025-11-01.pdf"));
const lifePages = await pages(join(process.cwd(), "tests/golden/fixtures/lifecore-tactical-2026-01-15.pdf"));

const aqua = parseAllSurfacesRlPriceList(aquaPages);
const casa = parseAllSurfacesRlPriceList(casaPages);
const congo = parseAllSurfacesRlPriceList(congoPages);
const contract = parseAllSurfacesRlPriceList(contractPages);
const life = parseAllSurfacesRlPriceList(lifePages);

describe("All Surfaces RL price lists", () => {
  it("reads each list and leaves other price lists alone", async () => {
    expect(aqua?.distributor).toBe("All Surfaces");
    expect(aqua?.manufacturer).toBe("Aquaproof");
    expect(aqua?.effective).toBe("October 15, 2026");
    expect(aqua?.rows).toHaveLength(105);

    expect(casa?.manufacturer).toBe("Casabella");
    expect(casa?.effective).toBe("March 2, 2026");
    expect(casa?.rows).toHaveLength(158);

    expect(congo?.manufacturer).toBe("Congoleum");
    expect(congo?.rows).toHaveLength(17);

    expect(contract?.manufacturer).toBe("Contract 180");
    expect(contract?.effective).toBe("November 01, 2025");
    expect(contract?.rows).toHaveLength(41);

    expect(life?.manufacturer).toBe("LifeCore");
    expect(life?.effective).toBe("January 15, 2026");
    expect(life?.rows).toHaveLength(247);

    const bishop = await pages(join(process.cwd(), "tests/golden/fixtures/bishop-030835-pricelist-summary.pdf"));
    expect(parseAllSurfacesRlPriceList(bishop)).toBeNull();
    expect(parseBishopPriceList(aquaPages)).toBeNull();
    expect(parseLwFlooringPriceList(casaPages)).toBeNull();
    expect(readFileSync("src/app/(app)/catalog/import-actions.ts", "utf8")).toContain(
      "parseAllSurfacesRlPriceList",
    );
  });

  it("prices Aquaproof planks and the molding on that color", () => {
    const rows = aqua?.rows ?? [];
    const barkers = find(rows, "AP107BP");
    expect(barkers.name).toBe("Aquaproof Barkers Point");
    expect(barkers.category).toBe("lvp");
    expect(barkers.unit).toBe("sqft");
    expect(barkers.material_rate).toBe(2.1);
    expect(barkers.notes).toContain("25.4 SF/ctn");

    const nose = find(rows, "7517996288");
    expect(nose.name).toBe("Aquaproof Barkers Point Flush Stair Nose");
    expect(nose.category).toBe("trim");
    expect(nose.unit).toBe("each");
    expect(nose.material_rate).toBe(57.81);

    const kit = find(rows, "CBLFTSSBARKERSPO");
    expect(kit.material_rate).toBe(189.98);
    expect(kit.notes).toContain("Color may vary");

    const arden = find(rows, "CBLFTECARDEN");
    expect(arden.name).toBe("Aquaproof Arden End Cap");
    expect(arden.material_rate).toBe(37.49);
    expect(arden.notes).toContain('94.49"');

    const balboa = find(rows, "AP129BB");
    expect(balboa.name).toBe("Aquaproof XL Balboa");
    expect(balboa.material_rate).toBe(2.52);
    expect(balboa.notes).toContain("27.9 SF/ctn");
    expect(rows.some((row) => row.sku === "CBLFTSSBALBOA")).toBe(false);

    expect(find(rows, "EAVCONFIDENCE").material_rate).toBe(21.99);
    expect(find(rows, "MPGMB4250175").name).toBe("Aquaproof Moisture Block Vapor Barrier 42\"x50' (175SF)");
    expect(find(rows, "MPGMB4250175").material_rate).toBe(31.5);
    expect(find(rows, "CBL8000001").material_rate).toBe(3.89);
  });

  it("prices Casabella collections from their own molding header", () => {
    const rows = casa?.rows ?? [];
    const oak = find(rows, "CWH5712");
    expect(oak.name).toBe("Casabella Downtown Asheville Oak");
    expect(oak.material_rate).toBe(2.25);
    expect(oak.notes).toContain("25.52 SF/ctn");
    expect(find(rows, "4391027628").material_rate).toBe(34.56);
    expect(find(rows, "6655296340").name).toContain("Flush Stair Nose");
    expect(find(rows, "6655296340").material_rate).toBe(44.41);

    const auburn = find(rows, "EWH3651");
    expect(auburn.name).toBe("Casabella Downtown Deluxe Auburn");
    expect(auburn.material_rate).toBe(2.25);
    expect(find(rows, "7678496300").material_rate).toBe(31.1);

    expect(find(rows, "CWH5706").name).toBe("Casabella Intown Metropolitan");
    expect(find(rows, "CWH5706").material_rate).toBe(2.59);
    expect(find(rows, "CWH3714").name).toBe("Casabella Intown Plus Soho");
    expect(find(rows, "ATFFUSCASBCHSETUT9").material_rate).toBe(17.99);
    expect(rows.some((row) => /contact sales/i.test(row.name))).toBe(false);
  });

  it("prices Congoleum at the retail column and keeps the display price", () => {
    const rows = congo?.rows ?? [];
    const plank = findName(rows, 'Congoleum Triversa Prime 9" x 48"');
    expect(plank.material_rate).toBe(3.55);
    expect(plank.unit).toBe("sqft");
    expect(plank.notes).toContain("Display $2.82");
    expect(plank.notes).toContain("24.16 SF/ctn");
    expect(findName(rows, 'Congoleum Triversa Prime 7" x 48"').notes).toContain("23.90 SF/ctn");

    const pad = find(rows, "UF120061");
    expect(pad.name).toBe("Congoleum Underflor");
    expect(pad.category).toBe("underlayment");
    expect(pad.unit).toBe("sqyd");
    expect(pad.material_rate).toBe(5.1);
    expect(pad.roll_rate).toBe(3.77);

    expect(find(rows, "CR021").name).toBe("Congoleum CR021 Adhesive 1 Quart");
    expect(find(rows, "CR021").material_rate).toBe(14.38);
    expect(findName(rows, "Congoleum Pressure Sensitive 1 Gallon").material_rate).toBe(39.65);
    expect(findName(rows, "Congoleum Pressure Sensitive 4 Gallon").material_rate).toBe(126.03);
    expect(find(rows, "3001").material_rate).toBe(8.07);
    expect(findName(rows, "Congoleum Multi-Trim").material_rate).toBe(27.61);
    expect(findName(rows, "Congoleum Flush Mount Stair Nose").material_rate).toBe(27.47);
    expect(findName(rows, "Congoleum Quarter Round").material_rate).toBe(8.32);
  });

  it("prices Contract 180 carpet by the square yard and resilient by the square foot", () => {
    const rows = contract?.rows ?? [];
    const chicago = find(rows, "15217");
    expect(chicago.name).toBe("Contract 180 CCT Chicago");
    expect(chicago.category).toBe("carpet");
    expect(chicago.unit).toBe("sqyd");
    expect(chicago.material_rate).toBe(21.96);
    expect(chicago.notes).toContain("City Collection");
    expect(chicago.notes).toContain("8 sy/ctn");

    const detroit = find(rows, "84218");
    expect(detroit.notes).toContain("Special order");
    expect(find(rows, "15217L").notes).toContain("Let's Go! Collection");
    expect(find(rows, "82214L").name).toBe("Contract 180 CCT KCMO");

    const almond = find(rows, "49622");
    expect(almond.name).toBe("Contract 180 HRT Almond Blend");
    expect(almond.category).toBe("lvp");
    expect(almond.unit).toBe("sqft");
    expect(almond.material_rate).toBe(2.83);
    expect(almond.notes).toContain("38.75 SF/ctn");
    expect(find(rows, "49634").notes).toContain("Special order");

    const lunar = find(rows, "42542");
    expect(lunar.name).toBe("Contract 180 HRK Lunar");
    expect(lunar.material_rate).toBe(2.83);
    expect(lunar.notes).toContain("35.95 SF/ctn");
    expect(rows.some((row) => row.sku === "MAP1951204")).toBe(false);
  });

  it("prices LifeCore engineered hardwood and the 78 inch trim", () => {
    const rows = life?.rows ?? [];
    const artful = find(rows, "AB127AR");
    expect(artful.name).toBe("LifeCore Abella Artful");
    expect(artful.category).toBe("hardwood");
    expect(artful.unit).toBe("sqft");
    expect(artful.material_rate).toBe(5.68);
    expect(artful.notes).toContain("Acacia");
    expect(artful.notes).toContain("7½");
    expect(artful.notes).toContain("30.56 SF/ctn");
    expect(find(rows, "S2ACB3659H1SN").material_rate).toBe(70.78);
    expect(find(rows, "S2ACB3659H1QR").material_rate).toBe(34.8);

    const narrow = find(rows, "AD127PP");
    expect(narrow.notes).toContain("7¼");
    expect(narrow.notes).toContain("28.99 sf/ctn");
    expect(find(rows, "C2WOE3319TH").material_rate).toBe(47.97);

    expect(find(rows, "GS2HIB3604HTH").material_rate).toBe(41.2);
    expect(find(rows, "GS2HIB3604HQR").material_rate).toBe(25.4);
    expect(find(rows, "ST46").material_rate).toBe(115.77);
    expect(find(rows, "MAP1942715").material_rate).toBe(155.56);
    expect(find(rows, "MAP1947715").material_rate).toBe(275.93);
    expect(find(rows, "MAP1947958").material_rate).toBe(22.13);
    expect(find(rows, "LCWINGDISP").name).toBe("LifeCore Wing Display");
    expect(find(rows, "LCWINGDISP").material_rate).toBe(399);
  });

  it("gives every product one price and one name", () => {
    const rows = [aqua, casa, congo, contract, life].flatMap((book) => book?.rows ?? []);
    const names = new Set<string>();
    for (const row of rows) {
      expect(row.material_rate).toBeGreaterThan(0);
      expect(row.manufacturer).toBeTruthy();
      expect(names.has(row.name)).toBe(false);
      names.add(row.name);
    }
    expect(names.size).toBe(105 + 158 + 17 + 41 + 247);
  });
});

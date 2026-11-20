/**
 * Engineered Floors PRTPRC, effective 11/16/2026.
 * Carpet cost is the cut. Hard surface cost is the carton (STD) price.
 * One style code can be a plank and a piece of trim. Carpet tile stays carpet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEngineeredFloorsPriceList } from "@/lib/engineered-floors-price";
import { readPriceText } from "@/lib/price-sheet";

const text = readFileSync(
  join(process.cwd(), "tests/golden/fixtures/engineered-floors-prtprc-2026-11-16.txt"),
  "utf8",
);

function row(name: string) {
  const found = parseEngineeredFloorsPriceList(text)?.find((r) => r.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe("Engineered Floors price list", () => {
  const rows = parseEngineeredFloorsPriceList(text) ?? [];

  it("reads every product on the sheet once", () => {
    expect(rows).toHaveLength(300);
    expect(new Set(rows.map((r) => r.name.toLowerCase())).size).toBe(300);
    expect(rows.every((r) => r.manufacturer === "Engineered Floors")).toBe(true);
    expect(rows.every((r) => r.color == null)).toBe(true);
    expect(rows.every((r) => (r.material_rate ?? 0) > 0)).toBe(true);
  });

  it("prices carpet at the cut and keeps the cheaper roll", () => {
    const acclaim = row("Acclaim 12'");
    expect(acclaim.category).toBe("carpet");
    expect(acclaim.unit).toBe("sqyd");
    expect(acclaim.material_rate).toBe(7.33);
    expect(acclaim.roll_rate).toBe(6.33);
    expect(acclaim.sku).toBe("1324");

    const air = row("Airwaves 12'");
    expect(air.material_rate).toBe(6.1);
    expect(air.roll_rate ?? null).toBeNull();
    expect(air.notes).toContain("Price $6.10");
  });

  it("prices hard surface at the carton price and trim at each", () => {
    const plank = row("Advantage 7\" x 48\" Floating");
    expect(plank.category).toBe("lvp");
    expect(plank.unit).toBe("sqft");
    expect(plank.material_rate).toBe(2.79);
    expect(plank.roll_rate ?? null).toBeNull();

    const end = row("Advantage 2x94 End Cap");
    expect(end.category).toBe("trim");
    expect(end.unit).toBe("each");
    expect(end.material_rate).toBe(27);
    expect(end.sku).toBe("W020");
    expect(end.name).not.toBe(plank.name);

    expect(row("Gallatin Plank 7\" x 48\" Dry Back").material_rate).toBe(1.22);
    expect(row("Gallatin Plank 7\" x 48\" Lux Vinyl").material_rate).toBe(0.89);
    expect(row("Avenue 7\" x 48\" Dry Back").sku).toBe("P1000");
    expect(row("Avenue 7\" x 48\" Lux Vinyl").sku).toBe("P1000");
    expect(row("Empower 7\" x 48\" Floating").category).toBe("laminate");
    expect(row("Empower 7\" x 48\" Floating").material_rate).toBe(2.59);
  });

  it("keeps carpet tile in carpet and splits shared names by style code", () => {
    const tile = row("Amplify Tile 24x24");
    expect(tile.category).toBe("carpet");
    expect(tile.unit).toBe("sqyd");
    expect(tile.notes).toContain("Carpet tile.");

    expect(row("Yellowstone 12' (1220)").material_rate).toBe(8.89);
    expect(row("Yellowstone 12' (4330)").material_rate).toBe(8.9);
    expect(row("Yellowstone Fleck 12'").sku).toBe("5240");
    expect(row("Preseason 12' (EF315)").material_rate).toBe(4.72);
    expect(row("Preseason 12' (E315)").material_rate).toBe(4.72);
    expect(row("Windy City III 12'").material_rate).toBe(13.66);
    expect(row("Sophisticated 12'").sku).toBe("5755");
    expect(row("Wood Tech 8x54 Floating").category).toBe("laminate");
    expect(row("Wood Tech 8x54 Floating").material_rate).toBe(1.79);
  });

  it("is the price book the importer keeps as mixed products", () => {
    const read = readPriceText(text);
    expect(read?.preserveCategories).toBe(true);
    expect(read?.sheet).toBe(false);
    expect(read?.rows).toHaveLength(300);
    expect(parseEngineeredFloorsPriceList("Style Name\tColor\tCut\nAnnapolis\tLinen\t4.99")).toBeNull();
  });

  it("matches the SQL the price list is loaded from", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/0511_engineered_floors_prtprc.sql"),
      "utf8",
    );
    expect(sql.match(/"name":/g)?.length).toBe(rows.length);
    expect(sql).toContain('"name": "Acclaim 12\'"');
    expect(sql).toContain('"material_rate": 7.33');
    expect(sql).toContain('"material_rate": 1.22');
    expect(sql).toContain('"material_rate": 0.89');
    expect(sql).toContain("Engineered Floors");
    expect(sql).not.toContain("0507");
    expect(sql).not.toContain("0510");
  });
});

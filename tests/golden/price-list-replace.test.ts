import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planPriceListReplace } from "@/lib/price-list-replace";

const actions = readFileSync("src/app/(app)/catalog/import-actions.ts", "utf8");
const importer = readFileSync("src/app/(app)/catalog/smart-importer.tsx", "utf8");
const worker = readFileSync("src/lib/import-worker.ts", "utf8");
const sql = readFileSync("supabase/migrations/0514_price_list_replace.sql", "utf8");

const oak = {
  id: "oak-old",
  name: "LW Flooring Oak Natural",
  manufacturer: "LW Flooring",
  style: "Oak",
  color: "Natural",
  unit: "sqft",
  category: "hardwood",
  active: true,
  updated_at: "2026-01-01",
  material_rate: 4,
};
const oakCopy = {
  ...oak,
  id: "oak-copy",
  name: "LW Flooring  Oak Natural",
  updated_at: "2026-02-01",
  material_rate: 4.5,
};
const dropped = {
  id: "dropped",
  name: "LW Flooring Oak Sand",
  manufacturer: "LW Flooring",
  style: "Oak",
  color: "Sand",
  unit: "sqft",
  category: "hardwood",
  active: true,
  updated_at: "2026-01-01",
  material_rate: 3,
};
const lvp = {
  id: "lvp",
  name: "LW Flooring Stone",
  manufacturer: "LW Flooring",
  style: "Stone",
  color: "Grey",
  unit: "sqft",
  category: "lvp",
  active: true,
  updated_at: "2026-01-01",
  material_rate: 2,
};
const otherMill = {
  id: "other",
  name: "Shaw Oak Natural",
  manufacturer: "Shaw",
  style: "Oak",
  color: "Natural",
  unit: "sqft",
  category: "hardwood",
  active: true,
  updated_at: "2026-03-01",
  material_rate: 5,
};

describe("a new price list replaces the old one", () => {
  it("updates the duplicate and turns off the color the new list dropped", () => {
    const plan = planPriceListReplace([oak, oakCopy, dropped, lvp, otherMill], [
      {
        name: "LW Flooring Oak Natural",
        manufacturer: "LW Flooring",
        style: "Oak",
        color: "Natural",
        unit: "sqft",
        category: "hardwood",
      },
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ id: "oak-copy", index: 0 }]);
    expect(plan.retire.sort()).toEqual(["dropped", "oak-old"]);
    expect(plan.retire).not.toContain("lvp");
    expect(plan.retire).not.toContain("other");
  });

  it("does not turn off another mill when the list has no manufacturer", () => {
    const plan = planPriceListReplace([oak, otherMill], [
      { name: "Brand new color", category: "hardwood" },
    ]);
    expect(plan.inserts).toEqual([0]);
    expect(plan.retire).toEqual([]);
  });

  it("treats the same style and color as one product even when the name changed", () => {
    const plan = planPriceListReplace([oak], [
      {
        name: "LW Oak Natural 2026",
        manufacturer: "LW Flooring",
        style: "Oak",
        color: "Natural",
        unit: "sqft",
        category: "hardwood",
      },
    ]);
    expect(plan.updates).toEqual([{ id: "oak-old", index: 0 }]);
    expect(plan.inserts).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it("keeps two colors that share a sku", () => {
    const sandy = {
      ...oak,
      id: "sandy",
      name: "Happy Feet Regency Sandy Bay",
      style: "Regency",
      color: "Sandy Bay",
    };
    const mustang = {
      ...oak,
      id: "mustang",
      name: "Happy Feet Mustang Sawtooth",
      style: "Mustang",
      color: "Sawtooth",
    };
    const plan = planPriceListReplace([sandy, mustang], [
      {
        name: sandy.name,
        manufacturer: "LW Flooring",
        style: "Regency",
        color: "Sandy Bay",
        unit: "sqft",
        category: "hardwood",
      },
      {
        name: mustang.name,
        manufacturer: "LW Flooring",
        style: "Mustang",
        color: "Sawtooth",
        unit: "sqft",
        category: "hardwood",
      },
    ]);
    expect(plan.retire).toEqual([]);
    expect(plan.updates.map((row) => row.id).sort()).toEqual(["mustang", "sandy"]);
  });

  it("does not treat another mill's product as a duplicate of the same words", () => {
    const shaw = { ...oak, id: "shaw", manufacturer: "Shaw" };
    const plan = planPriceListReplace([oak, shaw], [
      {
        name: oak.name,
        manufacturer: "LW Flooring",
        style: "Oak",
        color: "Natural",
        unit: "sqft",
        category: "hardwood",
      },
    ]);
    expect(plan.updates).toEqual([{ id: "oak-old", index: 0 }]);
    expect(plan.retire).not.toContain("shaw");
  });
});

describe("the importer writes the new price and turns the old one off", () => {
  it("replaces the kept row and deactivates what the list dropped", () => {
    expect(actions).toContain("planPriceListReplace");
    expect(actions).toContain("material_rate: item.material_rate");
    expect(actions).toContain("active: false");
    expect(importer).not.toContain("instead of adding duplicates");
    expect(worker).toContain("do_update: true");
  });

  it("turns off existing copies without deleting them or changing the kept price", () => {
    expect(sql).toContain("set active = false");
    expect(sql).toContain("Does NOT enable accounting");
    expect(sql.toLowerCase()).not.toContain("delete from public.products");
  });
});

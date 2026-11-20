/**
 * Locks the guided Schönox counts to the calculator at
 * https://schonox.sika.com/calculator/ (coefficients pulled 2026-11-20).
 * units = ceil(area × rowValue / coefficient). No 5–10% pad.
 */
import { describe, expect, it } from "vitest";
import { schonoxCount, schonoxProduct } from "@/lib/schonox-calculator";

describe("Schönox calculator", () => {
  it("counts S1500 bags at 24 sq ft per bag at 1/4 inch", () => {
    expect(schonoxCount(24, "s1500", '1/4"')?.units).toBe(1);
    expect(schonoxCount(25, "s1500", '1/4"')?.units).toBe(2);
    expect(schonoxCount(1000, "s1500", '1/4"')).toMatchObject({
      units: 42,
      unit: "bag",
      name: "Schönox S1500",
      coverageSqft: 24,
      thicknessIn: 0.25,
    });
  });

  it("counts US bags at 56 sq ft per bag at 1/8 inch", () => {
    expect(schonoxCount(56, "us", '1/8"')?.units).toBe(1);
    expect(schonoxCount(57, "us", '1/8"')?.units).toBe(2);
    expect(schonoxCount(560, "us", '1/2"')?.units).toBe(40);
  });

  it("counts DSP PLUS at 12 sq ft per bag at 3/8 inch", () => {
    expect(schonoxCount(12, "dsp-plus", '3/8"')?.units).toBe(1);
    expect(schonoxCount(13, "dsp-plus", '3/8"')?.units).toBe(2);
  });

  it("counts XM and ZM at 60 sq ft per bag at 1/8 inch", () => {
    expect(schonoxCount(60, "xm", '1/8"')?.units).toBe(1);
    expect(schonoxCount(60, "zm", '1/8"')?.units).toBe(1);
    expect(schonoxCount(61, "zm-rapid", '1/8"')?.units).toBe(2);
  });

  it("counts VD, KH FIX, and SHP the way the primer rows are published", () => {
    expect(schonoxCount(1300, "vd", "Undiluted")?.units).toBe(1);
    expect(schonoxCount(1500, "vd", "Diluted 1:1")?.units).toBe(1);
    expect(schonoxCount(2000, "vd", "Diluted 1:3")?.units).toBe(1);
    expect(schonoxCount(2001, "vd", "Diluted 1:3")).toMatchObject({
      units: 2,
      unit: "each",
      thicknessIn: null,
    });
    expect(schonoxCount(960, "kh-fix", "Primer over porous surface")?.units).toBe(1);
    expect(schonoxCount(580, "kh-fix", "Primer over absorbent surface")?.units).toBe(1);
    expect(schonoxCount(581, "kh-fix", "Primer over absorbent surface")?.units).toBe(2);
    expect(schonoxCount(425, "shp", "1 Gallon unit")?.units).toBe(1);
    expect(schonoxCount(426, "shp", "1 Gallon unit")?.units).toBe(2);
    expect(schonoxCount(1000, "mr-18", "One coat system")?.units).toBe(1);
    expect(schonoxCount(1001, "mr-18", "One coat system")?.units).toBe(2);
    expect(schonoxCount(500, "mr-18", "Two coat system")?.units).toBe(1);
    expect(schonoxCount(290, "epa", "One coat system")?.units).toBe(1);
    expect(schonoxCount(291, "epa", "One coat system")?.units).toBe(2);
    expect(schonoxCount(300, "epa-rapid", "One coat system")?.units).toBe(1);
    expect(schonoxCount(301, "epa-rapid", "One coat system")?.units).toBe(2);
  });

  it("does not invent a count without an area or a published row", () => {
    expect(schonoxCount(0, "us", '1/8"')).toBeNull();
    expect(schonoxCount(100, "us", '9"')).toBeNull();
    expect(schonoxCount(100, "missing", '1/8"')).toBeNull();
    expect(schonoxProduct("vd")?.rows.map((r) => r.label)).toEqual([
      "Undiluted",
      "Diluted 1:1",
      "Diluted 1:3",
    ]);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  commitMeasureAreaInput,
  formatMeasureArea,
  formatMeasureAreaLabel,
} from "@/lib/measure-area-unit";

const root = join(__dirname, "../..");

describe("square feet and square yards convert both ways", () => {
  it("shows a stored square-foot area in either unit without rewriting it", () => {
    expect(formatMeasureArea(100, "sqft")).toBe("100");
    expect(formatMeasureArea(100, "sqyd")).toBe("11.11");
    expect(formatMeasureArea(100, "sqft")).toBe("100");
    expect(formatMeasureAreaLabel(168, "sqyd")).toBe("18.67 sq yd");
    expect(formatMeasureAreaLabel(168, "sqft")).toBe("168 sq ft");
  });

  it("saves a typed yardage as square feet and shows the same yards again", () => {
    const stored = commitMeasureAreaInput("10", "sqyd");
    expect(stored).toBe("90");
    expect(formatMeasureArea(Number(stored), "sqyd")).toBe("10");
    expect(formatMeasureArea(Number(stored), "sqft")).toBe("90");
    expect(formatMeasureArea(Number(stored), "sqyd")).toBe("10");
  });

  it("saves a typed square-foot total and shows the same feet after a yards view", () => {
    const stored = commitMeasureAreaInput("168", "sqft");
    expect(stored).toBe("168");
    expect(formatMeasureArea(Number(stored), "sqyd")).toBe("18.67");
    expect(formatMeasureArea(Number(stored), "sqft")).toBe("168");
  });

  it("keeps a typed yard figure after switching to feet and back", () => {
    const stored = commitMeasureAreaInput("18.67", "sqyd");
    expect(stored).toBe("168.03");
    expect(formatMeasureArea(Number(stored), "sqft")).toBe("168.03");
    expect(formatMeasureArea(Number(stored), "sqyd")).toBe("18.67");
  });

  it("leaves an unfinished keystroke alone", () => {
    expect(commitMeasureAreaInput(".", "sqyd")).toBeNull();
    expect(commitMeasureAreaInput("", "sqft")).toBe("");
  });
});

describe("measurement entry asks for width before length", () => {
  function slice(src: string, start: string, end: string) {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i + start.length);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    return src.slice(i, j);
  }

  it("guided rooms, sections, and carpet cuts put width first", () => {
    const q = readFileSync(join(root, "src/app/(app)/estimates/questionnaire.tsx"), "utf8");
    const areas = slice(
      q,
      'if (q.kind === "areas" && answer?.kind === "areas")',
      'if (q.kind === "floor_map" && answer?.kind === "floor_map")',
    );
    const width = areas.indexOf('label="Width"');
    const length = areas.indexOf('label="Length"');
    const width2 = areas.indexOf('label="Width"', width + 1);
    const length2 = areas.indexOf('label="Length"', length + 1);
    expect(width).toBeGreaterThan(-1);
    expect(width).toBeLessThan(length);
    expect(length).toBeLessThan(width2);
    expect(width2).toBeLessThan(length2);

    const cutWidth = q.indexOf('aria-label="Width (ft)"');
    const cutLength = q.indexOf('label={ci === 0 ? "Length"');
    expect(cutWidth).toBeGreaterThan(-1);
    expect(cutWidth).toBeLessThan(cutLength);
  });

  it("builder lines, the area calculator, and saved customer areas put width first", () => {
    const lines = readFileSync(join(root, "src/app/(app)/estimates/line-measurements.tsx"), "utf8");
    expect(lines.indexOf('aria-label="Width feet"')).toBeLessThan(lines.indexOf('aria-label="Length feet"'));

    const calc = readFileSync(join(root, "src/components/area-calculator.tsx"), "utf8");
    expect(calc.indexOf("Width (ft / in)")).toBeLessThan(calc.indexOf("Length (ft / in)"));
    expect(calc.indexOf('aria-label="Width feet"')).toBeLessThan(calc.indexOf('aria-label="Length feet"'));

    const fields = readFileSync(join(root, "src/components/measure-area-unit.tsx"), "utf8");
    expect(fields.indexOf('name="wid_ft"')).toBeLessThan(fields.indexOf('name="len_ft"'));
  });
});

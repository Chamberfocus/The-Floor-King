import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  areaRowFromCheck,
  canTakeoffDrawing,
  carpetPlan,
  drawingRoomNote,
  matchAreaId,
  parseDrawing,
  reviewDrawing,
} from "@/lib/drawing-takeoff";

const SHEET = `Living room 12'6" x 18'4" carpet
Hall 3-6 x 22-0 carpet
Kitchen 12 x 14 LVP = 168 sq ft
Stairs 13
Total 500 sq ft
`;

describe("drawing takeoff", () => {
  it("reads width before length and ignores the sheet total", () => {
    const rooms = parseDrawing(SHEET);
    expect(rooms.map((r) => r.name)).toEqual(["Living room", "Hall", "Kitchen", "Stairs"]);
    expect(rooms[0]).toMatchObject({ widthFt: 12, widthIn: 6, lengthFt: 18, lengthIn: 4, floor: "carpet" });
    expect(rooms[1]).toMatchObject({ widthFt: 3, widthIn: 6, lengthFt: 22, lengthIn: 0, floor: "carpet" });
    expect(rooms[2]).toMatchObject({ widthFt: 12, widthIn: 0, lengthFt: 14, lengthIn: 0, floor: "lvp", writtenSqft: 168 });
    expect(rooms[3].stairs).toBe(13);
  });

  it("suggests 15 ft goods when 12 ft needs a seam and orders more carpet", () => {
    const plan12 = carpetPlan(13, 20, 12);
    const plan15 = carpetPlan(13, 20, 15);
    expect(plan12?.orderedSqft).toBe(312);
    expect(plan12?.seams).toBe(1);
    expect(plan15?.orderedSqft).toBe(300);
    expect(plan15?.seams).toBe(0);
    const review = reviewDrawing(parseDrawing("Family room 13 x 20 carpet"));
    expect(review.rooms[0].suggestedRoll).toBe(15);
    expect(review.suggestedRoll).toBe(15);
    expect(review.totalSqft).toBe(260);
  });

  it("shows both carpet widths and suggests the one that orders less", () => {
    const wide = reviewDrawing(parseDrawing("Bedroom 10 x 14 carpet"));
    expect(wide.rooms[0].carpet12).toMatchObject({ orderedSqft: 168, seams: 0 });
    expect(wide.rooms[0].carpet15).toMatchObject({ orderedSqft: 150, seams: 0 });
    expect(wide.rooms[0].suggestedRoll).toBe(15);
    const narrow = reviewDrawing(parseDrawing("Bedroom 8 x 10 carpet"));
    expect(narrow.rooms[0].suggestedRoll).toBe(12);
    expect(narrow.roll12Sqyd).toBeLessThan(narrow.roll15Sqyd ?? 0);
  });

  it("flags a written square footage that does not match width times length", () => {
    const review = reviewDrawing(parseDrawing("Kitchen 12 x 14 LVP = 200 sq ft"));
    expect(review.rooms[0].measuredSqft).toBe(168);
    expect(review.checks.some((c) => c.includes("168") && c.includes("200"))).toBe(true);
  });

  it("reads a decimal foot as inches and does not invent stair square footage", () => {
    const rooms = parseDrawing("Master 15.5 x 12 carpet\nStairs 8");
    expect(rooms[0]).toMatchObject({ widthFt: 15, widthIn: 6, lengthFt: 12, lengthIn: 0 });
    const review = reviewDrawing(rooms);
    expect(review.totalSqft).toBe(186);
    expect(review.checks.some((c) => c.includes("8 stairs"))).toBe(true);
    expect(drawingRoomNote(review.rooms[1])).toContain("8 stairs");
  });

  it("saves width as the first dimension and keeps a second room with the same name", () => {
    const review = reviewDrawing(parseDrawing("Living room 12'6\" x 18'4\" carpet\nBedroom 8 x 10 carpet"));
    const living = areaRowFromCheck(review.rooms[0]);
    expect(living).toMatchObject({ width_in: 150, length_in: 220, sqft: 229.17 });
    expect(living.note).toContain("12 ft goods");
    expect(living.note).toContain("15 ft");
    const used = new Set<string>();
    const first = matchAreaId("Bedroom", [{ id: "a", name: "bedroom" }, { id: "b", name: "Hall" }], used);
    expect(first).toBe("a");
    used.add(first!);
    expect(matchAreaId("Bedroom", [{ id: "a", name: "bedroom" }, { id: "b", name: "Hall" }], used)).toBeNull();
    expect(canTakeoffDrawing("salesman")).toBe(true);
    expect(canTakeoffDrawing("crew")).toBe(false);
  });

  it("lets a salesperson save rooms on their own customer", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0507_drawing_takeoff_areas.sql"), "utf8");
    expect(sql).toContain("ca_sales_write");
    expect(sql).toContain("public.mine_customer(customer_areas.customer_id)");
    expect(sql).toContain("sales_manager");
    expect(sql).not.toMatch(/crew/);
    expect(sql.toLowerCase()).not.toContain("posting_enabled");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMAIL_FAILED_NOT_SENT,
  STALE_APPROVAL_CHARGES,
  approvedJobHandoff,
  claimSaveFlight,
  duplicateAreaName,
  employeeSaveError,
  areaChips,
  cloneRoomLines,
  EMPTY_AREA_NOT_SAVED,
  groupIndexedByRoom,
  listAreas,
  quantityCaption,
  releaseSaveFlight,
  renameAreaLabel,
  renameRoomOnLines,
  roomMatches,
  unsavedPendingAreas,
} from "@/lib/estimate-workflow";

describe("estimate room grouping", () => {
  it("lists rooms in first-seen order and keeps empty pending areas", () => {
    expect(
      listAreas(["Living Room", " kitchen ", "Living Room", ""], ["Hall", "kitchen"]),
    ).toEqual(["Living Room", "kitchen", "Hall"]);
  });

  it("groups lines under their room without dropping the original index", () => {
    const groups = groupIndexedByRoom([
      { line: { room: "Kitchen" }, li: 0 },
      { line: { room: "Living Room" }, li: 1 },
      { line: { room: "kitchen" }, li: 2 },
      { line: { room: "" }, li: 3 },
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Kitchen", "Living Room", ""]);
    expect(groups[0].rows.map((r) => r.li)).toEqual([0, 2]);
    expect(groups[2].rows.map((r) => r.li)).toEqual([3]);
  });

  it("renames and duplicates area labels without inventing quantities", () => {
    expect(renameAreaLabel("  Hall ", "Stairs")).toBe("Stairs");
    expect(renameAreaLabel("Hall", "  ")).toBeNull();
    expect(duplicateAreaName("Bedroom 1", ["Bedroom 1", "Bedroom 1 copy"])).toBe(
      "Bedroom 1 copy 2",
    );
    expect(roomMatches(" Living Room ", "living room")).toBe(true);
    expect(roomMatches("", "Kitchen")).toBe(false);
  });
});

describe("empty rooms, rename, and duplicate", () => {
  const kitchen = {
    room: "Kitchen",
    quantity: "120",
    unit: "sq ft",
    material_rate: "4.50",
    labor_rate: "2.00",
    description: "LVP",
  };
  const hall = {
    room: "Hall",
    quantity: "40",
    unit: "sq ft",
    material_rate: "3.25",
    labor_rate: "1.75",
    description: "Carpet",
  };

  it("marks a room with no line as pending and drops it once a line uses the name", () => {
    expect(areaChips(["Kitchen"], ["Hall", "Kitchen"])).toEqual([
      { name: "Kitchen", pending: false },
      { name: "Hall", pending: true },
    ]);
    expect(unsavedPendingAreas(["Kitchen"], ["Hall", "  "])).toEqual(["Hall"]);
    expect(unsavedPendingAreas(["Hall"], ["Hall"])).toEqual([]);
    expect(EMPTY_AREA_NOT_SAVED).toMatch(/not saved/i);
    expect(EMPTY_AREA_NOT_SAVED).toMatch(/line/i);
  });

  it("renames only the room field on lines in that room", () => {
    const renamed = renameRoomOnLines([kitchen, hall], "Kitchen", "Living Room");
    expect(renamed.name).toBe("Living Room");
    expect(renamed.lines).toHaveLength(2);
    expect(renamed.lines[0]).toEqual({ ...kitchen, room: "Living Room" });
    expect(renamed.lines[1]).toEqual(hall);
    expect(renameRoomOnLines([kitchen], "Kitchen", "  ").name).toBeNull();
    expect(renameRoomOnLines([kitchen], "Kitchen", "Kitchen").lines).toEqual([kitchen]);
  });

  it("duplicates a room by cloning its lines and preserves quantity and price", () => {
    const copies = cloneRoomLines([kitchen, hall], "Kitchen", "Kitchen copy");
    expect(copies).toEqual([{ ...kitchen, room: "Kitchen copy" }]);
    expect(copies[0].quantity).toBe("120");
    expect(copies[0].material_rate).toBe("4.50");
    expect(copies[0].labor_rate).toBe("2.00");
    expect(kitchen.room).toBe("Kitchen");
  });

  it("does not create a placeholder line for an empty room", () => {
    const lines = [kitchen];
    expect(cloneRoomLines(lines, "Basement", "Basement copy")).toEqual([]);
    expect(lines).toEqual([kitchen]);
    expect(unsavedPendingAreas(lines.map((line) => line.room), ["Basement"])).toEqual([
      "Basement",
    ]);
  });
});

describe("estimate quantity and save guards", () => {
  it("labels quantity with the line unit and does not convert it", () => {
    expect(quantityCaption("sq ft")).toBe("Quantity (sq ft)");
    expect(quantityCaption("sq yd")).toBe("Quantity (sq yd)");
    expect(quantityCaption("each")).toBe("Quantity (each)");
    expect(quantityCaption("  ")).toBe("Quantity");
  });

  it("blocks a second save while the first is in flight and releases after", () => {
    const lock = { current: false };
    expect(claimSaveFlight(lock)).toBe(true);
    expect(claimSaveFlight(lock)).toBe(false);
    releaseSaveFlight(lock);
    expect(claimSaveFlight(lock)).toBe(true);
  });

  it("hides database errors and keeps a human save failure", () => {
    expect(employeeSaveError("duplicate key value violates unique constraint")).toBe(
      "This estimate did not save. Check the lines and try again.",
    );
    expect(employeeSaveError("Add a product before saving.")).toBe(
      "Add a product before saving.",
    );
    expect(employeeSaveError("")).toBe("This estimate did not save. Try again.");
  });
});

describe("approval status and job handoff", () => {
  it("opens an existing job instead of offering another create", () => {
    expect(approvedJobHandoff(true)).toEqual({ label: "Open job", mode: "open" });
    expect(approvedJobHandoff(false)).toEqual({ label: "Create job", mode: "create" });
  });

  it("keeps send-failure and stale-approval wording factual", () => {
    expect(EMAIL_FAILED_NOT_SENT).toMatch(/not marked sent/);
    expect(EMAIL_FAILED_NOT_SENT).not.toMatch(/was updated/i);
    expect(STALE_APPROVAL_CHARGES).toMatch(/approval again/);
  });
});

describe("estimate workflow sources", () => {
  const builder = readFileSync("src/app/(app)/estimates/estimate-builder.tsx", "utf8");
  const page = readFileSync("src/app/(app)/estimates/[id]/page.tsx", "utf8");

  it("stamps new lines with the selected room and guards save and send", () => {
    expect(builder).toContain("room: activeArea");
    expect(builder).toContain("claimSaveFlight");
    expect(builder).toContain("EMPTY_AREA_NOT_SAVED");
    expect(builder).toContain("cloneRoomLines");
    expect(builder).toContain("Not saved");
    expect(builder).not.toContain("window.prompt");
    expect(builder).toContain("groupIndexedByRoom");
    expect(builder).toContain('id="sec-areas"');
    expect(builder).toContain('id="sec-extras"');
    expect(builder).not.toContain("auto-saves as you type");
  });

  it("uses the existing job handoff and does not add a second next-action engine", () => {
    expect(page).toContain("approvedJobHandoff");
    expect(page).toContain("EMAIL_FAILED_NOT_SENT");
    expect(page).toContain("STALE_APPROVAL_CHARGES");
    expect(page).not.toContain(">Next steps<");
  });

  it("does not touch scheduling, pricing modules, or accounting flags", () => {
    expect(builder).not.toContain("schedule_job_install_safe");
    expect(page).not.toContain("books_of_record");
    const pricing = readFileSync("src/lib/estimate-calc.ts", "utf8");
    expect(pricing).not.toContain("estimate-workflow");
  });
});

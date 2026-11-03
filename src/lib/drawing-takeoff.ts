/**
 * Read a salesperson's job drawing into rooms, square footage, and a 12 ft
 * vs 15 ft carpet suggestion. The salesperson checks every number. Square
 * footage is width × length. Carpet yardage is the goods actually pulled
 * off a 12 ft or 15 ft roll, not the bare room area.
 */
import { formatFtIn } from "@/lib/flooring-knowledge/takeoff";

export type DrawingFloor = "carpet" | "lvp" | "hardwood" | "laminate" | "tile" | "vinyl" | "";

export interface DrawingRoom {
  name: string;
  widthFt: number;
  widthIn: number;
  lengthFt: number;
  lengthIn: number;
  /** Square footage written on the drawing, when they wrote a total. */
  writtenSqft: number | null;
  floor: DrawingFloor;
  stairs: number | null;
  note: string;
}

export interface CarpetPlan {
  rollFt: 12 | 15;
  pieces: number;
  seams: number;
  /** Length pulled off the roll, in feet. */
  cutLengthFt: number;
  orderedSqft: number;
  orderedSqyd: number;
  measuredSqft: number;
  wasteSqft: number;
  label: string;
}

export interface RoomCheck {
  room: DrawingRoom;
  measuredSqft: number;
  checks: string[];
  carpet12: CarpetPlan | null;
  carpet15: CarpetPlan | null;
  /** Lower ordered yardage for this room. */
  suggestedRoll: 12 | 15 | null;
}

export interface DrawingTakeoff {
  rooms: RoomCheck[];
  totalSqft: number;
  carpetMeasuredSqft: number;
  /** One goods width for every carpet room on the drawing. */
  roll12Sqyd: number | null;
  roll15Sqyd: number | null;
  suggestedRoll: 12 | 15 | null;
  checks: string[];
}

const FLOORS: Record<string, DrawingFloor> = {
  carpet: "carpet",
  broadloom: "carpet",
  lvp: "lvp",
  lvt: "lvp",
  spc: "lvp",
  plank: "lvp",
  hardwood: "hardwood",
  wood: "hardwood",
  laminate: "laminate",
  tile: "tile",
  ceramic: "tile",
  porcelain: "tile",
  vinyl: "vinyl",
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function feetOf(ft: number, inch: number): number {
  const f = Number.isFinite(ft) ? ft : 0;
  const i = Number.isFinite(inch) ? inch : 0;
  const carried = f + i / 12;
  return carried > 0 ? carried : 0;
}

function carry(ft: number, inch: number): { ft: number; inch: number } {
  let f = Math.max(0, Math.floor(ft));
  let i = inch + (ft - Math.floor(ft)) * 12;
  i = Math.round(i);
  if (i >= 12) {
    f += Math.floor(i / 12);
    i = i % 12;
  }
  if (i < 0) i = 0;
  return { ft: f, inch: i };
}

function floorOf(raw: string): DrawingFloor {
  const t = raw.toLowerCase();
  if (/carpet tile|modular carpet/.test(t)) return "carpet";
  for (const [word, floor] of Object.entries(FLOORS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(t)) return floor;
  }
  return "";
}

function formatLen(ft: number): string {
  const whole = Math.floor(ft + 1e-9);
  const inch = Math.round((ft - whole) * 12);
  if (inch === 12) return formatFtIn(whole + 1, 0);
  return formatFtIn(whole, inch) || `${round2(ft)} ft`;
}

/** 12 ft or 15 ft goods for one room. Picks the direction that orders less carpet. */
export function carpetPlan(widthFt: number, lengthFt: number, rollFt: 12 | 15): CarpetPlan | null {
  if (!(widthFt > 0) || !(lengthFt > 0)) return null;
  const measuredSqft = round2(widthFt * lengthFt);
  const orient = (across: number, along: number) => {
    const pieces = Math.max(1, Math.ceil((across - 0.02) / rollFt));
    const orderedSqft = round2(pieces * rollFt * along);
    return { pieces, seams: pieces - 1, cutLengthFt: along, orderedSqft };
  };
  const acrossWidth = orient(widthFt, lengthFt);
  const acrossLength = orient(lengthFt, widthFt);
  const best =
    acrossLength.orderedSqft < acrossWidth.orderedSqft - 0.05
      ? acrossLength
      : acrossWidth.orderedSqft < acrossLength.orderedSqft - 0.05
        ? acrossWidth
        : acrossWidth.seams <= acrossLength.seams
          ? acrossWidth
          : acrossLength;
  const wasteSqft = round2(Math.max(0, best.orderedSqft - measuredSqft));
  const piece =
    best.pieces === 1
      ? `${rollFt} ft goods × ${formatLen(best.cutLengthFt)} long`
      : `${best.pieces} pieces of ${rollFt} ft goods × ${formatLen(best.cutLengthFt)} long`;
  const seam = best.seams === 0 ? "no seam" : best.seams === 1 ? "1 seam" : `${best.seams} seams`;
  return {
    rollFt,
    pieces: best.pieces,
    seams: best.seams,
    cutLengthFt: round2(best.cutLengthFt),
    orderedSqft: best.orderedSqft,
    orderedSqyd: round2(best.orderedSqft / 9),
    measuredSqft,
    wasteSqft,
    label: `${piece}, ${seam}`,
  };
}

function justOver(sideFt: number, roll: number): boolean {
  const over = sideFt - roll;
  return over > 0.02 && over <= 0.3;
}

export function reviewDrawing(rooms: DrawingRoom[]): DrawingTakeoff {
  const checks: string[] = [];
  const reviewed: RoomCheck[] = rooms.map((room) => {
    const width = feetOf(room.widthFt, room.widthIn);
    const length = feetOf(room.lengthFt, room.lengthIn);
    const fromSides = width > 0 && length > 0 ? round2(width * length) : 0;
    const measuredSqft = fromSides > 0 ? fromSides : room.writtenSqft && room.writtenSqft > 0 ? round2(room.writtenSqft) : 0;
    const roomChecks: string[] = [];
    if (fromSides > 0 && room.writtenSqft && Math.abs(fromSides - room.writtenSqft) > 1) {
      roomChecks.push(
        `${room.name}: width × length is ${fromSides} sq ft and the drawing shows ${room.writtenSqft} sq ft.`,
      );
    }
    if (!room.floor) roomChecks.push(`${room.name}: flooring is not written on the drawing.`);
    if (room.floor === "carpet" && !(width > 0 && length > 0)) {
      roomChecks.push(`${room.name}: carpet needs a width and a length before a 12 ft or 15 ft cut can be suggested.`);
    }
    if (justOver(width, 12) || justOver(length, 12)) {
      roomChecks.push(`${room.name} is just over 12 ft on one side. Confirm it before a seam.`);
    }
    if (justOver(width, 15) || justOver(length, 15)) {
      roomChecks.push(`${room.name} is just over 15 ft on one side. Confirm it before a seam.`);
    }
    const carpet12 = room.floor === "carpet" ? carpetPlan(width, length, 12) : null;
    const carpet15 = room.floor === "carpet" ? carpetPlan(width, length, 15) : null;
    let suggestedRoll: 12 | 15 | null = null;
    if (carpet12 && carpet15) {
      suggestedRoll = carpet15.orderedSqft < carpet12.orderedSqft - 0.05 ? 15 : 12;
    }
    return { room, measuredSqft, checks: roomChecks, carpet12, carpet15, suggestedRoll };
  });

  const totalSqft = round2(reviewed.reduce((s, r) => s + r.measuredSqft, 0));
  const carpet = reviewed.filter((r) => r.carpet12 && r.carpet15);
  const carpetMeasuredSqft = round2(carpet.reduce((s, r) => s + r.measuredSqft, 0));
  const roll12Sqyd = carpet.length ? round2(carpet.reduce((s, r) => s + (r.carpet12?.orderedSqyd ?? 0), 0)) : null;
  const roll15Sqyd = carpet.length ? round2(carpet.reduce((s, r) => s + (r.carpet15?.orderedSqyd ?? 0), 0)) : null;
  let suggestedRoll: 12 | 15 | null = null;
  if (roll12Sqyd != null && roll15Sqyd != null) {
    suggestedRoll = roll15Sqyd < roll12Sqyd - 0.05 ? 15 : 12;
    checks.push(
      suggestedRoll === 12
        ? `12 ft carpet for the carpet rooms is ${roll12Sqyd} sq yd. 15 ft carpet is ${roll15Sqyd} sq yd.`
        : `15 ft carpet for the carpet rooms is ${roll15Sqyd} sq yd. 12 ft carpet is ${roll12Sqyd} sq yd.`,
    );
  }
  for (const room of reviewed) checks.push(...room.checks);
  const stairs = reviewed.reduce((s, r) => s + (r.room.stairs ?? 0), 0);
  if (stairs > 0) {
    checks.push(`${stairs} stair${stairs === 1 ? "" : "s"} on the drawing. Stair square footage is not included until it is measured.`);
  }
  return {
    rooms: reviewed,
    totalSqft,
    carpetMeasuredSqft,
    roll12Sqyd,
    roll15Sqyd,
    suggestedRoll,
    checks,
  };
}

function parseDim(raw: string): { ft: number; inch: number } | null {
  const t = raw.trim();
  const dec = t.match(/^(\d{1,2})\.(\d+)$/);
  if (dec) {
    const inch = Math.round(Number(`0.${dec[2]}`) * 12);
    return carry(Number(dec[1]), inch);
  }
  const m = t.match(/^(\d{1,2})\s*(?:'|ft)?\s*(?:-\s*|\s+)?(\d{1,2})?\s*(?:"|in)?$/i);
  if (!m) return null;
  return carry(Number(m[1]), m[2] ? Number(m[2]) : 0);
}

const DIM = String.raw`(\d{1,2}(?:\.\d+)?(?:\s*'\s*\d{1,2}\s*"?|\s*-\s*\d{1,2}|\s+\d{1,2}\s*"?)?)`;
const PAIR = new RegExp(`${DIM}\\s*[x×]\\s*${DIM}`, "i");

function cleanName(raw: string): string {
  return raw.replace(/[:\-–—]+$/g, "").replace(/\s+/g, " ").trim();
}

/** One line the salesperson wrote on the drawing. */
export function parseDrawingLine(line: string): DrawingRoom | null {
  const raw = line.replace(/\u00a0/g, " ").trim();
  if (!raw || /^(total|grand total|page)\b/i.test(raw)) return null;

  const stairsOnly =
    raw.match(/^(?:stairs?|steps?)\s+(\d{1,3})\b/i) ?
      ([raw, "Stairs", raw.match(/(\d{1,3})/)?.[1]] as const) :
    raw.match(/^(?:(.+?)\s+)?(\d{1,3})\s*(?:stairs?|steps?)\b/i);
  const pair = raw.match(PAIR);
  if (stairsOnly && !pair) {
    const name = cleanName(stairsOnly[1] || "Stairs") || "Stairs";
    return {
      name,
      widthFt: 0,
      widthIn: 0,
      lengthFt: 0,
      lengthIn: 0,
      writtenSqft: null,
      floor: /carpet/i.test(raw) ? "carpet" : "",
      stairs: Number(stairsOnly[2]),
      note: "",
    };
  }
  if (!pair || pair.index == null) {
    const area = raw.match(/^(.*?)(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sf)\b(.*)$/i);
    if (!area) return null;
    const name = cleanName(area[1]);
    if (!name) return null;
    return {
      name,
      widthFt: 0,
      widthIn: 0,
      lengthFt: 0,
      lengthIn: 0,
      writtenSqft: round2(Number(area[2])),
      floor: floorOf(`${area[1]} ${area[3]}`),
      stairs: null,
      note: "",
    };
  }

  const width = parseDim(pair[1]);
  const length = parseDim(pair[2]);
  if (!width || !length) return null;
  const name = cleanName(raw.slice(0, pair.index));
  if (!name) return null;
  const rest = raw.slice(pair.index + pair[0].length);
  const written = rest.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|sf)\b/i);
  const stair = rest.match(/(\d{1,3})\s*(?:stairs?|steps?)\b/i);
  return {
    name,
    widthFt: width.ft,
    widthIn: width.inch,
    lengthFt: length.ft,
    lengthIn: length.inch,
    writtenSqft: written ? round2(Number(written[1])) : null,
    floor: floorOf(rest),
    stairs: stair ? Number(stair[1]) : null,
    note: "",
  };
}

export function parseDrawing(text: string): DrawingRoom[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(parseDrawingLine)
    .filter((r): r is DrawingRoom => !!r);
}

export function normalizeExtractedRoom(input: {
  name?: string | null;
  width_ft?: number | null;
  width_in?: number | null;
  length_ft?: number | null;
  length_in?: number | null;
  sqft?: number | null;
  floor?: string | null;
  stairs?: number | null;
  note?: string | null;
}): DrawingRoom | null {
  const name = (input.name ?? "").trim();
  if (!name) return null;
  const width = carry(Number(input.width_ft) || 0, Number(input.width_in) || 0);
  const length = carry(Number(input.length_ft) || 0, Number(input.length_in) || 0);
  return {
    name,
    widthFt: width.ft,
    widthIn: width.inch,
    lengthFt: length.ft,
    lengthIn: length.inch,
    writtenSqft: input.sqft && input.sqft > 0 ? round2(input.sqft) : null,
    floor: floorOf(input.floor ?? ""),
    stairs: input.stairs && input.stairs > 0 ? Math.round(input.stairs) : null,
    note: (input.note ?? "").trim(),
  };
}

const DRAWING_TAKEOFF_ROLES = ["admin", "office", "sales_manager", "salesman"] as const;

export function canTakeoffDrawing(role: string): boolean {
  return (DRAWING_TAKEOFF_ROLES as readonly string[]).includes(role);
}

export function drawingTakeoffRoles(): Array<(typeof DRAWING_TAKEOFF_ROLES)[number]> {
  return [...DRAWING_TAKEOFF_ROLES];
}

function sentence(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Note stored with the room so the saved area still shows the carpet check. */
export function drawingRoomNote(check: RoomCheck): string {
  const bits = [check.room.note, check.room.floor].filter(Boolean);
  if (check.room.stairs && check.room.stairs > 0) {
    bits.push(`${check.room.stairs} stair${check.room.stairs === 1 ? "" : "s"}`);
  }
  if (check.suggestedRoll === 12 && check.carpet12) bits.push(`12 ft goods: ${check.carpet12.label}`);
  if (check.suggestedRoll === 15 && check.carpet15) bits.push(`15 ft goods: ${check.carpet15.label}`);
  if (check.carpet12 && check.carpet15 && check.suggestedRoll) {
    const other = check.suggestedRoll === 12 ? check.carpet15 : check.carpet12;
    bits.push(`Other width ${other.rollFt} ft: ${other.label}`);
  }
  bits.push(...check.checks);
  return bits.map(sentence).filter(Boolean).join(" ");
}

/** Inches stored on the customer area. Width stays the first dimension. */
export function drawingInches(ft: number, inch: number): number {
  const feet = feetOf(ft, inch);
  if (!(feet > 0)) return 0;
  return Math.round(feet * 12);
}

export function sqftFromInches(widthIn: number, lengthIn: number): number {
  if (!(widthIn > 0) || !(lengthIn > 0)) return 0;
  return round2((widthIn / 12) * (lengthIn / 12));
}

/** One reviewed room, ready to update or insert a customer area. */
export function areaRowFromCheck(check: RoomCheck): {
  name: string;
  length_in: number | null;
  width_in: number | null;
  sqft: number | null;
  note: string | null;
} {
  const widthIn = drawingInches(check.room.widthFt, check.room.widthIn);
  const lengthIn = drawingInches(check.room.lengthFt, check.room.lengthIn);
  const fromSides = sqftFromInches(widthIn, lengthIn);
  const sqft = fromSides > 0 ? fromSides : check.measuredSqft > 0 ? check.measuredSqft : null;
  return {
    name: check.room.name.trim(),
    length_in: lengthIn > 0 ? lengthIn : null,
    width_in: widthIn > 0 ? widthIn : null,
    sqft,
    note: drawingRoomNote(check) || null,
  };
}

/** Same room name updates the existing area. A second copy stays a new row. */
export function matchAreaId(
  name: string,
  areas: { id: string; name: string }[],
  used: Set<string>,
): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const hit = areas.find((area) => !used.has(area.id) && area.name.trim().toLowerCase() === key);
  return hit?.id ?? null;
}

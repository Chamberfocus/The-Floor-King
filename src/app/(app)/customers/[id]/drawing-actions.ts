"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { extractDrawing, getLastExtractError } from "@/lib/extract";
import { employeeDbError } from "@/lib/employee-error";
import {
  areaRowFromCheck,
  drawingTakeoffRoles,
  matchAreaId,
  normalizeExtractedRoom,
  reviewDrawing,
  type DrawingFloor,
  type DrawingRoom,
} from "@/lib/drawing-takeoff";
import type { UserRole } from "@/lib/types";
import { safeDisplayFileName, safeStorageFileName } from "@/lib/upload-name";

const ROLES = drawingTakeoffRoles() as UserRole[];
const FLOORS = new Set<DrawingFloor>(["carpet", "lvp", "hardwood", "laminate", "tile", "vinyl", ""]);
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"]);
const MAX_ROOMS = 40;

export interface DrawingReadResult {
  error: string | null;
  rooms?: DrawingRoom[];
}

export interface DrawingSaveResult {
  error: string | null;
  saved?: number;
  fileError?: string | null;
}

function num(value: unknown, cap: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(cap, Math.max(0, n));
}

function roomFromPayload(value: unknown): DrawingRoom | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const floor = typeof raw.floor === "string" && FLOORS.has(raw.floor as DrawingFloor) ? raw.floor : "";
  return normalizeExtractedRoom({
    name: typeof raw.name === "string" ? raw.name.slice(0, 80) : "",
    width_ft: num(raw.widthFt, 200),
    width_in: num(raw.widthIn, 120),
    length_ft: num(raw.lengthFt, 200),
    length_in: num(raw.lengthIn, 120),
    sqft: num(raw.writtenSqft, 100000) || null,
    floor,
    stairs: num(raw.stairs, 200) || null,
    note: typeof raw.note === "string" ? raw.note.slice(0, 240) : "",
  });
}

function mediaTypeOf(file: File): string | null {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (PHOTO_TYPES.has(type)) return type;
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  return null;
}

/** Read a photo or scanned PDF of the drawing. Typed text is read in the browser. */
export async function readDrawingImage(formData: FormData): Promise<DrawingReadResult> {
  try {
    await assertRole(ROLES);
  } catch {
    return { error: "Sign in as a salesperson or the office to read a drawing." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a drawing." };
  if (file.size > 20 * 1024 * 1024) return { error: "File is too large (max 20 MB)." };
  const mediaType = mediaTypeOf(file);
  if (!mediaType) return { error: "Use a JPG, PNG, WEBP, or PDF, or paste the writing." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "Paste the writing from that drawing. Photo reading needs the AI key." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const extracted = await extractDrawing({ base64: bytes.toString("base64"), mediaType });
  if (!extracted?.length) {
    return { error: getLastExtractError() || "Couldn't read rooms on that drawing. Paste the writing instead." };
  }
  const rooms = extracted
    .map((room) => normalizeExtractedRoom(room))
    .filter((room): room is DrawingRoom => !!room);
  if (!rooms.length) return { error: "Couldn't read rooms on that drawing. Paste the writing instead." };
  return { error: null, rooms };
}

/** Save checked rooms onto this customer. A matching room name is updated. */
export async function saveDrawingRooms(formData: FormData): Promise<DrawingSaveResult> {
  let profile;
  try {
    profile = await assertRole(ROLES);
  } catch {
    return { error: "Sign in as a salesperson or the office to save these rooms." };
  }
  const customerId = typeof formData.get("customer_id") === "string" ? String(formData.get("customer_id")).trim() : "";
  if (!customerId) return { error: "Missing customer." };

  let payload: unknown;
  try {
    payload = JSON.parse(typeof formData.get("rooms") === "string" ? String(formData.get("rooms")) : "");
  } catch {
    return { error: "Those rooms could not be read. Check them and try again." };
  }
  if (!Array.isArray(payload) || payload.length === 0) return { error: "Add at least one room." };
  if (payload.length > MAX_ROOMS) return { error: `A drawing can save ${MAX_ROOMS} rooms at a time.` };

  const rooms = payload
    .map(roomFromPayload)
    .filter((room): room is DrawingRoom => !!room && !!room.name.trim());
  if (!rooms.length) return { error: "Add a room name before saving." };

  const review = reviewDrawing(rooms);
  const supabase = await createClient();
  const { data: existing, error: listError } = await supabase
    .from("customer_areas")
    .select("id, name, position, differs")
    .eq("customer_id", customerId)
    .order("position", { ascending: true });
  if (listError) {
    return { error: employeeDbError(listError.message, "These rooms could not be saved on this customer.") };
  }

  const list = (existing ?? []) as { id: string; name: string; position: number; differs: boolean }[];
  const used = new Set<string>();
  let position = list.reduce((max, area) => Math.max(max, area.position || 0), 0);

  for (const check of review.rooms) {
    const row = areaRowFromCheck(check);
    if (!row.name) continue;
    const matchId = matchAreaId(row.name, list, used);
    if (matchId) {
      used.add(matchId);
      const current = list.find((area) => area.id === matchId);
      const { error } = await supabase
        .from("customer_areas")
        .update({ ...row, differs: current?.differs ?? false })
        .eq("id", matchId);
      if (error) return { error: employeeDbError(error.message, "These rooms could not be saved on this customer.") };
    } else {
      position += 10;
      const { error } = await supabase.from("customer_areas").insert({
        ...row,
        customer_id: customerId,
        position,
        differs: false,
      });
      if (error) return { error: employeeDbError(error.message, "These rooms could not be saved on this customer.") };
    }
  }

  const carpet =
    review.suggestedRoll === 12
      ? `${review.roll12Sqyd} sq yd of 12 ft carpet`
      : review.suggestedRoll === 15
        ? `${review.roll15Sqyd} sq yd of 15 ft carpet`
        : "";
  const { error: noteError } = await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: profile.id,
    type: "note",
    body: `Drawing takeoff: ${review.rooms.length} room${review.rooms.length === 1 ? "" : "s"}, ${review.totalSqft} sq ft.${carpet ? ` Suggested ${carpet}.` : ""}`,
  });
  if (noteError) console.error("[saveDrawingRooms] activity", noteError.code);

  let fileError: string | null = null;
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) {
      fileError = "The rooms are saved. The drawing file is over 20 MB, so it was not kept.";
    } else {
      const bytes = Buffer.from(await file.arrayBuffer());
      const path = `customer/${customerId}/${safeStorageFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
      });
      if (uploadError) {
        console.error("[saveDrawingRooms] upload", uploadError.name);
        fileError = "The rooms are saved. The drawing file itself could not be kept.";
      } else {
        const { error: docError } = await supabase.from("documents").insert({
          customer_id: customerId,
          uploaded_by: profile.id,
          name: safeDisplayFileName(file.name),
          path,
          mime: file.type || null,
          kind: "measurement",
        });
        if (docError) {
          console.error("[saveDrawingRooms] document", docError.code);
          await supabase.storage.from("documents").remove([path]);
          fileError = employeeDbError(docError.message, "The rooms are saved. The drawing file itself could not be kept.");
        }
      }
    }
  }

  revalidatePath(`/customers/${customerId}`);
  return { error: null, saved: review.rooms.length, fileError };
}

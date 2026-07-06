"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import {
  addTimeOff,
  deleteTimeOff,
  setWorkDays,
} from "@/lib/data/team-schedule";
import {
  syncTimeOffToGoogle,
  removeTimeOffFromGoogle,
} from "@/lib/data/google-calendar";

export interface DayOffState {
  error: string | null;
  ok?: boolean;
}

const KINDS = ["off", "vacation", "sick", "personal"];

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Post a day (or range) off. Anyone posts their own; office/admin for anyone. */
export async function addDayOff(
  _prev: DayOffState,
  formData: FormData,
): Promise<DayOffState> {
  const profile = await requireProfile();
  if (profile.role === "customer") return { error: "Not allowed." };
  const isManager = profile.role === "admin" || profile.role === "office";

  const requested = str(formData.get("user_id"));
  const userId = isManager && requested ? requested : profile.id;

  const start = str(formData.get("start_date"));
  let end = str(formData.get("end_date")) || start;
  const kindRaw = str(formData.get("kind"));
  const kind = KINDS.includes(kindRaw) ? kindRaw : "off";
  const note = str(formData.get("note")) || null;

  if (!start) return { error: "Pick a date." };
  if (end < start) end = start;

  const id = await addTimeOff({
    userId,
    startDate: start,
    endDate: end,
    kind,
    note,
  });
  if (!id) return { error: "Couldn't save — please try again." };

  await syncTimeOffToGoogle(id); // best-effort mirror to shared calendar
  revalidatePath("/team");
  return { error: null, ok: true };
}

/** Remove a day off (own, or office/admin). */
export async function removeDayOff(id: string): Promise<void> {
  const profile = await requireProfile();
  if (profile.role === "customer" || !id) return;
  await removeTimeOffFromGoogle(id);
  await deleteTimeOff(id); // RLS guards who may actually delete
  revalidatePath("/team");
}

/** Set one person's regular weekly working days (office/admin only). */
export async function saveWorkDays(
  userId: string,
  days: number[],
): Promise<void> {
  const profile = await requireProfile();
  if (!(profile.role === "admin" || profile.role === "office")) return;
  if (!userId) return;
  const clean = Array.from(new Set(days.filter((d) => d >= 0 && d <= 6))).sort(
    (a, b) => a - b,
  );
  await setWorkDays(userId, clean.join(","));
  revalidatePath("/team");
}

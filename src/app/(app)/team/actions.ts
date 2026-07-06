"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import {
  addTimeOff,
  deleteTimeOff,
  decideTimeOff,
  findConflicts,
  setShift,
  clearShift,
  setOverride,
  clearOverride,
  listManagerEmails,
} from "@/lib/data/team-schedule";
import { getProfileNames } from "@/lib/data/customers";
import {
  syncTimeOffToGoogle,
  removeTimeOffFromGoogle,
} from "@/lib/data/google-calendar";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";

export interface DayOffState {
  error: string | null;
  ok?: boolean;
  pending?: boolean;
  /** Names of people already off on the requested days (coverage clash). */
  conflicts?: string[];
}

const KINDS = ["off", "vacation", "sick", "personal"];
const KIND_LABEL: Record<string, string> = {
  off: "Day off",
  vacation: "Vacation",
  sick: "Sick",
  personal: "Personal",
};

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function fmt(start: string, end: string): string {
  return start === end ? start : `${start} → ${end}`;
}

/**
 * Request a day (or range) off. Auto-approved when nobody else is off those
 * days; if it clashes with someone already off it goes to a manager to approve,
 * and they get an email. Approved days off mirror to the shared calendar.
 */
export async function requestDayOff(
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

  const clashes = await findConflicts(userId, start, end);
  const conflictNames = clashes.length
    ? Object.values(await getProfileNames(clashes.map((c) => c.user_id)))
    : [];

  // Managers posting directly are trusted to have checked coverage → approve.
  const status = clashes.length && !isManager ? "pending" : "approved";

  const id = await addTimeOff({
    userId,
    startDate: start,
    endDate: end,
    kind,
    note,
    status,
  });
  if (!id) return { error: "Couldn't save — please try again." };

  if (status === "approved") {
    await syncTimeOffToGoogle(id); // best-effort mirror to shared calendar
  } else {
    await notifyManagersOfRequest({
      requester:
        Object.values(await getProfileNames([userId]))[0] || "A team member",
      range: fmt(start, end),
      kind: KIND_LABEL[kind] ?? "Day off",
      conflictNames,
    });
  }

  revalidatePath("/team");
  return {
    error: null,
    ok: true,
    pending: status === "pending",
    conflicts: conflictNames,
  };
}

async function notifyManagersOfRequest(info: {
  requester: string;
  range: string;
  kind: string;
  conflictNames: string[];
}): Promise<void> {
  const emails = await listManagerEmails();
  if (!emails.length) return;
  const clash = info.conflictNames.length
    ? `<p><strong>Heads up:</strong> ${info.conflictNames.join(
        ", ",
      )} ${info.conflictNames.length > 1 ? "are" : "is"} already off during this time.</p>`
    : "";
  const html = emailLayout(
    "Time-off request needs approval",
    `<p><strong>${info.requester}</strong> requested time off.</p>
     <p>${info.kind} · ${info.range}</p>
     ${clash}`,
    { label: "Review request", url: `${siteUrl()}/team` },
  );
  await Promise.all(
    emails.map((to) =>
      sendEmail({ to, subject: `Time-off request — ${info.requester}`, html }),
    ),
  );
}

/** Approve a pending request (manager). Mirrors it to the shared calendar. */
export async function approveDayOff(id: string): Promise<void> {
  const profile = await requireProfile();
  if (!(profile.role === "admin" || profile.role === "office") || !id) return;
  await decideTimeOff(id, "approved");
  await syncTimeOffToGoogle(id);
  revalidatePath("/team");
}

/** Deny a pending request (manager). */
export async function denyDayOff(id: string): Promise<void> {
  const profile = await requireProfile();
  if (!(profile.role === "admin" || profile.role === "office") || !id) return;
  await decideTimeOff(id, "denied");
  revalidatePath("/team");
}

/** Remove a day off (own, or manager). */
export async function removeDayOff(id: string): Promise<void> {
  const profile = await requireProfile();
  if (profile.role === "customer" || !id) return;
  await removeTimeOffFromGoogle(id);
  await deleteTimeOff(id); // RLS guards who may actually delete
  revalidatePath("/team");
}

/**
 * Change a person's schedule from the week grid (office/admin).
 *  - mode "series": sets the recurring weekly template for that weekday (and
 *    clears any one-off override on this date so it follows the series).
 *  - mode "date": sets a one-off override for just this date.
 * `off: true` means not working; otherwise start/end are the hours.
 */
export async function applyShift(input: {
  userId: string;
  mode: "date" | "series";
  date: string;
  weekday: number;
  start: string | null;
  end: string | null;
  off: boolean;
}): Promise<{ error: string | null }> {
  const profile = await requireProfile();
  if (!(profile.role === "admin" || profile.role === "office"))
    return { error: "Not allowed." };
  const { userId, mode, date, weekday, start, end, off } = input;
  if (!userId || weekday < 0 || weekday > 6 || !date)
    return { error: "Invalid change." };

  let error: string | null = null;
  if (mode === "series") {
    const r1 = off
      ? await clearShift(userId, weekday)
      : start && end
        ? await setShift(userId, weekday, start, end)
        : { error: null };
    const r2 = await clearOverride(userId, date); // follow the series again
    error = r1.error || r2.error;
  } else {
    if (off) error = (await setOverride(userId, date, null, null, true)).error;
    else if (start && end)
      error = (await setOverride(userId, date, start, end, false)).error;
  }
  revalidatePath("/team");
  return { error };
}

/** Drop a date's one-off override — that day goes back to the normal hours. */
export async function clearDayOverride(
  userId: string,
  date: string,
): Promise<{ error: string | null }> {
  const profile = await requireProfile();
  if (!(profile.role === "admin" || profile.role === "office"))
    return { error: "Not allowed." };
  if (!userId || !date) return { error: "Invalid change." };
  const { error } = await clearOverride(userId, date);
  revalidatePath("/team");
  return { error };
}

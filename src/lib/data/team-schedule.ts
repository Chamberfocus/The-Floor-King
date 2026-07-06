import { createClient } from "@/lib/supabase/server";

export type TimeOffStatus = "pending" | "approved" | "denied";

export interface TimeOff {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  kind: string;
  note: string | null;
  status: TimeOffStatus;
  created_by: string | null;
}

export interface Shift {
  start: string; // "HH:MM"
  end: string;
}

/** userId -> (weekday 0..6 -> hours). Missing weekday = not scheduled (off). */
export async function getShiftsMap(): Promise<
  Record<string, Record<number, Shift>>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_shifts")
    .select("user_id, weekday, start_time, end_time");
  const map: Record<string, Record<number, Shift>> = {};
  for (const r of data ?? []) {
    const uid = r.user_id as string;
    (map[uid] ??= {})[r.weekday as number] = {
      start: r.start_time as string,
      end: r.end_time as string,
    };
  }
  return map;
}

/** Set (or replace) one weekday's hours for a person (manager; RLS enforces). */
type DbResult = { error: string | null };

export async function setShift(
  userId: string,
  weekday: number,
  start: string,
  end: string,
): Promise<DbResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_shifts")
    .upsert({ user_id: userId, weekday, start_time: start, end_time: end });
  return { error: error?.message ?? null };
}

/** Mark a weekday off (remove the shift). */
export async function clearShift(
  userId: string,
  weekday: number,
): Promise<DbResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_shifts")
    .delete()
    .eq("user_id", userId)
    .eq("weekday", weekday);
  return { error: error?.message ?? null };
}

export interface Override {
  off: boolean;
  start?: string;
  end?: string;
}

/** userId -> (date -> one-off override) within [startYmd, endYmd]. */
export async function getOverrides(
  startYmd: string,
  endYmd: string,
): Promise<Record<string, Record<string, Override>>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shift_overrides")
    .select("user_id, date, start_time, end_time, off")
    .gte("date", startYmd)
    .lte("date", endYmd);
  const map: Record<string, Record<string, Override>> = {};
  for (const r of data ?? []) {
    const uid = r.user_id as string;
    (map[uid] ??= {})[r.date as string] = r.off
      ? { off: true }
      : {
          off: false,
          start: (r.start_time as string) ?? undefined,
          end: (r.end_time as string) ?? undefined,
        };
  }
  return map;
}

/** Set a one-off override for a single date (custom hours, or off). */
export async function setOverride(
  userId: string,
  date: string,
  start: string | null,
  end: string | null,
  off: boolean,
): Promise<DbResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("shift_overrides").upsert({
    user_id: userId,
    date,
    start_time: off ? null : start,
    end_time: off ? null : end,
    off,
    updated_at: new Date().toISOString(),
  });
  return { error: error?.message ?? null };
}

/** Remove a date's override — that day reverts to the recurring template. */
export async function clearOverride(
  userId: string,
  date: string,
): Promise<DbResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("shift_overrides")
    .delete()
    .eq("user_id", userId)
    .eq("date", date);
  return { error: error?.message ?? null };
}

const TIME_OFF_COLS =
  "id, user_id, start_date, end_date, kind, note, status, created_by";

/** Days off overlapping [startYmd, endYmd]. Pass statuses to filter. */
export async function listTimeOff(
  startYmd: string,
  endYmd: string,
  statuses: TimeOffStatus[] = ["approved"],
): Promise<TimeOff[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_off")
    .select(TIME_OFF_COLS)
    .in("status", statuses)
    .lte("start_date", endYmd)
    .gte("end_date", startYmd)
    .order("start_date", { ascending: true });
  return (data ?? []) as TimeOff[];
}

/** Pending requests from today onward, oldest first (the approval queue). */
export async function listPendingTimeOff(
  fromYmd: string,
): Promise<TimeOff[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_off")
    .select(TIME_OFF_COLS)
    .eq("status", "pending")
    .gte("end_date", fromYmd)
    .order("start_date", { ascending: true });
  return (data ?? []) as TimeOff[];
}

/** Other people already off (approved or pending) overlapping the request. */
export async function findConflicts(
  userId: string,
  startYmd: string,
  endYmd: string,
): Promise<TimeOff[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_off")
    .select(TIME_OFF_COLS)
    .neq("user_id", userId)
    .in("status", ["approved", "pending"])
    .lte("start_date", endYmd)
    .gte("end_date", startYmd);
  return (data ?? []) as TimeOff[];
}

/** Insert a day-off request with a decided status. Returns the new id. */
export async function addTimeOff(input: {
  userId: string;
  startDate: string;
  endDate: string;
  kind: string;
  note: string | null;
  status: TimeOffStatus;
}): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("time_off")
    .insert({
      user_id: input.userId,
      start_date: input.startDate,
      end_date: input.endDate,
      kind: input.kind,
      note: input.note,
      status: input.status,
      created_by: user?.id ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) return null;
  return (data?.id as string) ?? null;
}

/** Approve or deny a pending request (manager only; RLS enforces). */
export async function decideTimeOff(
  id: string,
  status: "approved" | "denied",
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase
    .from("time_off")
    .update({
      status,
      decided_by: user?.id ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function deleteTimeOff(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("time_off").delete().eq("id", id);
}

/** Emails of the people who approve time off (admin + office). */
export async function listManagerEmails(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("email")
    .in("role", ["admin", "office"]);
  return (data ?? [])
    .map((r) => r.email as string)
    .filter((e): e is string => !!e);
}

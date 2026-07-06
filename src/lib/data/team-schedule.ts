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
export async function setShift(
  userId: string,
  weekday: number,
  start: string,
  end: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("staff_shifts")
    .upsert({ user_id: userId, weekday, start_time: start, end_time: end });
}

/** Mark a weekday off (remove the shift). */
export async function clearShift(
  userId: string,
  weekday: number,
): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("staff_shifts")
    .delete()
    .eq("user_id", userId)
    .eq("weekday", weekday);
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

import { createClient } from "@/lib/supabase/server";

export interface TimeOff {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string;
  kind: string;
  note: string | null;
  created_by: string | null;
}

/** Each staffer's regular working days as a set of weekday numbers (0=Sun..6). */
export async function getWorkDaysMap(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_work_days")
    .select("user_id, work_days");
  const map: Record<string, string> = {};
  for (const r of data ?? []) {
    map[r.user_id as string] = (r.work_days as string) ?? "";
  }
  return map;
}

/** Set one person's weekly working days (admin/office; RLS enforces). */
export async function setWorkDays(
  userId: string,
  workDays: string,
): Promise<void> {
  const supabase = await createClient();
  await supabase.from("staff_work_days").upsert({
    user_id: userId,
    work_days: workDays,
    updated_at: new Date().toISOString(),
  });
}

/** Days off overlapping the [startYmd, endYmd] window (inclusive). */
export async function listTimeOff(
  startYmd: string,
  endYmd: string,
): Promise<TimeOff[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("time_off")
    .select("id, user_id, start_date, end_date, kind, note, created_by")
    .lte("start_date", endYmd)
    .gte("end_date", startYmd)
    .order("start_date", { ascending: true });
  return (data ?? []) as TimeOff[];
}

/** Post a day (or range) off. Returns the new row id, or null on failure. */
export async function addTimeOff(input: {
  userId: string;
  startDate: string;
  endDate: string;
  kind: string;
  note: string | null;
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
      created_by: user?.id ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) return null;
  return (data?.id as string) ?? null;
}

export async function deleteTimeOff(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("time_off").delete().eq("id", id);
}

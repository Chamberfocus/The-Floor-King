import { createClient } from "@/lib/supabase/server";
import { nextFreeWindow, workDaySet, ymd, type DateRange } from "@/lib/scheduling";
import type { SchedulingSettings } from "@/lib/types";

const DEFAULTS: SchedulingSettings = {
  id: "default",
  work_days: "1,2,3,4,5,6",
  day_start: "09:00",
  day_end: "17:00",
  estimate_duration_min: 60,
  travel_buffer_min: 30,
  cap_carpet_yd: 100,
  cap_lvt_sf: 250,
  cap_laminate_sf: 250,
  cap_hardwood_sf: 175,
  cap_tile_teardown_sf: 100,
  cap_subfloor_sheets: 10,
  cap_selflevel_sf: 600,
  updated_at: "",
};

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("scheduling_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return { ...DEFAULTS, ...(data ?? {}) } as SchedulingSettings;
}

export interface InstallerSuggestion {
  installerId: string;
  name: string;
  start: string;
  end: string;
}

/** Earliest available window per installer for a job needing `daysNeeded` days. */
export async function getInstallerSuggestions(
  daysNeeded: number,
  settings: SchedulingSettings,
  fromDate?: string,
): Promise<InstallerSuggestion[]> {
  if (daysNeeded <= 0) return [];
  const supabase = await createClient();
  const { data: insts } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "crew");
  const installers = (insts ?? []) as {
    id: string;
    full_name: string | null;
    email: string;
  }[];
  if (!installers.length) return [];

  const ids = installers.map((i) => i.id);
  const { data: jobs } = await supabase
    .from("jobs")
    .select("assigned_to, scheduled_date, scheduled_end")
    .in("assigned_to", ids)
    .not("scheduled_date", "is", null);
  const booked = new Map<string, DateRange[]>();
  for (const j of jobs ?? []) {
    const who = j.assigned_to as string;
    const start = j.scheduled_date as string;
    const end = (j.scheduled_end as string) || start;
    const arr = booked.get(who) ?? [];
    arr.push({ start, end });
    booked.set(who, arr);
  }

  const from = fromDate ?? ymd(new Date());
  const workDays = workDaySet(settings);
  const out: InstallerSuggestion[] = [];
  for (const inst of installers) {
    const win = nextFreeWindow(
      booked.get(inst.id) ?? [],
      workDays,
      daysNeeded,
      from,
    );
    if (win)
      out.push({
        installerId: inst.id,
        name: inst.full_name || inst.email,
        start: win.start,
        end: win.end,
      });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

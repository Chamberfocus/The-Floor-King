import { createClient } from "@/lib/supabase/server";
import { ymd } from "@/lib/scheduling";
import { formatWallTime, to12 } from "@/lib/format";

/** One stop on the signed-in rep's day — an estimate appointment or an install. */
export interface MyStop {
  id: string;
  kind: "estimate" | "install";
  customerId: string;
  customerName: string;
  timeLabel: string;
  address: string | null;
  sortKey: string;
  upcoming: boolean; // its time hasn't passed yet (used to pick the "next" stop)
}

function windowLabel(win: string): string {
  const [s, e] = win.split("-").map((x) => x.trim());
  if (!s || !e) return win;
  return `${to12(s)}–${to12(e)}`;
}

/**
 * The signed-in user's stops for today: estimate appointments they're the rep
 * on, plus installs assigned to them. Sorted by time. Powers the one-tap
 * "on my way" list + floating button so a rep never opens a customer's page.
 */
export async function myStopsToday(): Promise<MyStop[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const today = ymd(new Date());
  const nowIso = new Date().toISOString();

  const [{ data: appts }, { data: jobs }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, starts_at, address, is_block, kind, customer:customers(id, full_name, street, city, state)",
      )
      .eq("salesperson_id", user.id)
      .eq("status", "scheduled")
      .gte("starts_at", `${today}T00:00:00Z`)
      .lte("starts_at", `${today}T23:59:59Z`),
    supabase
      .from("jobs")
      .select(
        "id, scheduled_date, arrival_window, site_street, site_city, site_state, customer:customers(id, full_name)",
      )
      .eq("assigned_to", user.id)
      .eq("scheduled_date", today)
      .in("status", ["scheduled", "in_progress"]),
  ]);

  const stops: MyStop[] = [];

  for (const a of appts ?? []) {
    if (a.is_block || a.kind === "block") continue;
    const c = a.customer as unknown as {
      id: string;
      full_name: string | null;
      street: string | null;
      city: string | null;
      state: string | null;
    } | null;
    if (!c?.id) continue;
    const starts = a.starts_at as string;
    stops.push({
      id: a.id as string,
      kind: "estimate",
      customerId: c.id,
      customerName: c.full_name ?? "Customer",
      timeLabel: formatWallTime(starts),
      address:
        (a.address as string) ||
        [c.street, c.city, c.state].filter(Boolean).join(", ") ||
        null,
      sortKey: starts,
      upcoming: starts >= nowIso,
    });
  }

  for (const j of jobs ?? []) {
    const c = j.customer as unknown as {
      id: string;
      full_name: string | null;
    } | null;
    if (!c?.id) continue;
    const win = (j.arrival_window as string) || "";
    const winStart = win ? win.split("-")[0].trim() : "08:00";
    stops.push({
      id: j.id as string,
      kind: "install",
      customerId: c.id,
      customerName: c.full_name ?? "Customer",
      timeLabel: win ? windowLabel(win) : "Install",
      address:
        [j.site_street, j.site_city, j.site_state].filter(Boolean).join(", ") ||
        null,
      sortKey: `${today}T${winStart}:00Z`,
      upcoming: true,
    });
  }

  stops.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return stops;
}

import { createClient } from "@/lib/supabase/server";
import { listJobsOnDate } from "@/lib/data/jobs";
import { shopTodayYmd } from "@/lib/job-snapshot";
import { dayIsOverCapacity, roomSketches, shopDatePlus, sortPickLines, type RoomSketch } from "@/lib/shop-floor";

export type MorningRoll = {
  id: string;
  productName: string;
  rollNumber: string | null;
  dyeLot: string | null;
  qty: number;
  unit: string;
  location: string | null;
};

export type MorningJob = {
  id: string;
  title: string;
  customerName: string;
  site: string;
  arrival: string | null;
  claim: boolean;
  rolls: MorningRoll[];
  rooms: RoomSketch[];
};

export type MorningSheet = {
  date: string;
  jobs: MorningJob[];
  total: number;
  crews: number;
  overCapacity: boolean;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function loadMorningSheet(date?: string | null): Promise<MorningSheet> {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : shopDatePlus(shopTodayYmd(), 1);
  const listed = await listJobsOnDate({ date: day });
  const ids = listed.rows.map((job) => job.id);
  const optionIds = listed.rows
    .map((job) => job.option_id)
    .filter((id): id is string => !!id);
  const db = await createClient();

  const rollsByJob = new Map<string, MorningRoll[]>();
  if (ids.length) {
    const { data } = await db
      .from("stock_rolls")
      .select(
        "id, roll_number, dye_lot, remaining_qty, unit, location, assigned_job_id, product:products(name)",
      )
      .in("assigned_job_id", ids);
    for (const row of data ?? []) {
      const jobId = row.assigned_job_id as string;
      const product = one(row.product as { name?: string } | { name?: string }[] | null);
      const list = rollsByJob.get(jobId) ?? [];
      list.push({
        id: row.id as string,
        productName: product?.name?.trim() || "Roll",
        rollNumber: (row.roll_number as string | null) ?? null,
        dyeLot: (row.dye_lot as string | null) ?? null,
        qty: Number(row.remaining_qty) || 0,
        unit: (row.unit as string) || "",
        location: (row.location as string | null) ?? null,
      });
      rollsByJob.set(jobId, list);
    }
  }

  const roomsByOption = new Map<string, RoomSketch[]>();
  if (optionIds.length) {
    const { data } = await db
      .from("estimate_line_items")
      .select("option_id, room, length_in, width_in")
      .in("option_id", optionIds);
    const grouped = new Map<string, { room: string | null; lengthIn: number | null; widthIn: number | null }[]>();
    for (const row of data ?? []) {
      const optionId = row.option_id as string;
      const list = grouped.get(optionId) ?? [];
      list.push({
        room: (row.room as string | null) ?? null,
        lengthIn: row.length_in as number | null,
        widthIn: row.width_in as number | null,
      });
      grouped.set(optionId, list);
    }
    for (const [optionId, lines] of grouped) roomsByOption.set(optionId, roomSketches(lines));
  }

  let claimIds = new Set<string>();
  if (ids.length) {
    const { data, error } = await db.from("jobs").select("id").in("id", ids).eq("is_claim", true);
    if (!error) claimIds = new Set((data ?? []).map((row) => row.id as string));
  }

  const { count } = await db
    .from("install_crews")
    .select("id", { count: "exact", head: true })
    .eq("active", true);
  const crews = count ?? 0;

  const jobs: MorningJob[] = listed.rows.map((job) => {
    const site = [job.site_street, job.site_city].filter(Boolean).join(", ");
    return {
      id: job.id,
      title: job.title?.trim() || "Install",
      customerName: job.customer_name?.trim() || "Customer",
      site,
      arrival: job.arrival_window ?? null,
      claim: claimIds.has(job.id),
      rolls: sortPickLines(rollsByJob.get(job.id) ?? []),
      rooms: job.option_id ? roomsByOption.get(job.option_id) ?? [] : [],
    };
  });

  return {
    date: day,
    jobs,
    total: listed.total,
    crews,
    overCapacity: dayIsOverCapacity(listed.total, crews),
  };
}

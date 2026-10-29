import { createClient } from "@/lib/supabase/server";

export type ScannedRoll = {
  id: string;
  productName: string;
  rollNumber: string | null;
  dyeLot: string | null;
  qty: number;
  unit: string;
  location: string | null;
  status: string;
  assignedJobId: string | null;
};

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function shape(row: {
  id: string;
  roll_number: string | null;
  dye_lot: string | null;
  remaining_qty: number | null;
  unit: string | null;
  location: string | null;
  status: string | null;
  assigned_job_id: string | null;
  product: { name?: string } | { name?: string }[] | null;
}): ScannedRoll {
  const product = one(row.product);
  return {
    id: row.id,
    productName: product?.name?.trim() || "Roll",
    rollNumber: row.roll_number,
    dyeLot: row.dye_lot,
    qty: Number(row.remaining_qty) || 0,
    unit: row.unit || "",
    location: row.location,
    status: row.status || "available",
    assignedJobId: row.assigned_job_id,
  };
}

const COLUMNS =
  "id, roll_number, dye_lot, remaining_qty, unit, location, status, assigned_job_id, product:products(name)";

/** A scanned tag is the roll id. A typed code also matches the mill roll number. */
export async function findRolls(code: string): Promise<ScannedRoll[]> {
  const q = code.trim().replace(/[%_,]/g, "").slice(0, 80);
  if (q.length < 2) return [];
  const db = await createClient();
  if (/^[0-9a-f-]{32,36}$/i.test(q)) {
    const { data } = await db.from("stock_rolls").select(COLUMNS).eq("id", q).maybeSingle();
    return data ? [shape(data as never)] : [];
  }
  const like = `%${q}%`;
  const [byNumber, byLot] = await Promise.all([
    db.from("stock_rolls").select(COLUMNS).ilike("roll_number", like).limit(8),
    db.from("stock_rolls").select(COLUMNS).ilike("dye_lot", like).limit(8),
  ]);
  const seen = new Set<string>();
  const rows = [...(byNumber.data ?? []), ...(byLot.data ?? [])];
  return rows
    .filter((row) => {
      const id = row.id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((row) => shape(row as never));
}

export type TagRoll = ScannedRoll & { qr: string };

export async function listRollTags(): Promise<TagRoll[]> {
  const db = await createClient();
  const { data } = await db
    .from("stock_rolls")
    .select(COLUMNS)
    .eq("status", "available")
    .gt("remaining_qty", 0)
    .order("location", { ascending: true, nullsFirst: false })
    .limit(200);
  const QRCode = (await import("qrcode")).default;
  const tags: TagRoll[] = [];
  for (const row of data ?? []) {
    const roll = shape(row as never);
    const qr = await QRCode.toDataURL(roll.id, { margin: 1, width: 140 });
    tags.push({ ...roll, qr });
  }
  return tags;
}

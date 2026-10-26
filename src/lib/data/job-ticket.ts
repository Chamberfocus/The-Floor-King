import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface TicketRoll {
  id: string;
  productName: string;
  rollNumber: string | null;
  dyeLot: string | null;
  qty: number;
  unit: string;
  location: string | null;
}

export interface JobExtraRow {
  id: string;
  description: string;
  amount: number;
  signerName: string;
  signedAt: string;
}

/** Rolls staged for this job, or cut for it. Service role so the installer
 *  ticket can name the roll without opening the inventory tables to crew. */
export async function listTicketRolls(jobId: string): Promise<TicketRoll[]> {
  try {
    const admin = createAdminClient();
    const { data: moved } = await admin
      .from("stock_movements")
      .select("roll_id")
      .eq("job_id", jobId)
      .not("roll_id", "is", null);
    const movedIds = [
      ...new Set(
        (moved ?? [])
          .map((row) => row.roll_id as string | null)
          .filter((id): id is string => !!id),
      ),
    ];
    const { data: assigned } = await admin
      .from("stock_rolls")
      .select("id, roll_number, dye_lot, remaining_qty, unit, location, product:products(name)")
      .eq("assigned_job_id", jobId);
    let cut: typeof assigned = [];
    if (movedIds.length) {
      const res = await admin
        .from("stock_rolls")
        .select("id, roll_number, dye_lot, remaining_qty, unit, location, product:products(name)")
        .in("id", movedIds);
      cut = res.data ?? [];
    }
    const seen = new Set<string>();
    const rows = [...(assigned ?? []), ...(cut ?? [])].filter((row) => {
      const id = row.id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return rows.map((row) => {
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      return {
        id: row.id as string,
        productName: (product as { name?: string } | null)?.name ?? "Roll",
        rollNumber: (row.roll_number as string | null) ?? null,
        dyeLot: (row.dye_lot as string | null) ?? null,
        qty: Number(row.remaining_qty) || 0,
        unit: (row.unit as string) || "",
        location: (row.location as string | null) ?? null,
      };
    });
  } catch {
    return [];
  }
}

/** Available rolls for the products on a job, so the office can put one on the ticket. */
export async function listStageableRolls(
  productIds: string[],
): Promise<{ id: string; label: string }[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("stock_rolls")
      .select("id, roll_number, dye_lot, remaining_qty, unit, product:products(name)")
      .in("product_id", ids)
      .eq("status", "available")
      .gt("remaining_qty", 0)
      .order("created_at", { ascending: false })
      .limit(40);
    return (data ?? []).map((row) => {
      const product = Array.isArray(row.product) ? row.product[0] : row.product;
      const name = (product as { name?: string } | null)?.name ?? "Roll";
      const bits = [
        name,
        row.roll_number ? `roll ${row.roll_number}` : null,
        row.dye_lot ? `lot ${row.dye_lot}` : "no dye lot",
        `${row.remaining_qty} ${row.unit}`,
      ].filter(Boolean);
      return { id: row.id as string, label: bits.join(" · ") };
    });
  } catch {
    return [];
  }
}

export async function listJobExtras(jobId: string): Promise<JobExtraRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_extras")
    .select("id, description, amount, signer_name, signed_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    description: row.description as string,
    amount: Number(row.amount) || 0,
    signerName: row.signer_name as string,
    signedAt: row.signed_at as string,
  }));
}

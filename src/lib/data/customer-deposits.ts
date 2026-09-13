import { createClient } from "@/lib/supabase/server";

export type CustomerDepositRow = {
  id: string;
  amount: number;
  received_on: string;
  status: string;
  method: string | null;
  notes: string | null;
};

export async function getCustomerDepositSummary(customerId: string): Promise<{
  available: number;
  applied: number;
  voided: number;
  deposits: CustomerDepositRow[];
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_deposits")
    .select("id, amount, received_on, status, method, notes")
    .eq("customer_id", customerId)
    .order("received_on", { ascending: false });

  const deposits = (data ?? []).map((d) => ({
    id: d.id as string,
    amount: Number(d.amount) || 0,
    received_on: d.received_on as string,
    status: (d.status as string) ?? "unapplied",
    method: (d.method as string | null) ?? null,
    notes: (d.notes as string | null) ?? null,
  }));

  const ids = deposits.map((d) => d.id);
  const appliedBy = new Map<string, number>();
  if (ids.length) {
    const { data: apps } = await supabase
      .from("customer_deposit_applications")
      .select("deposit_id, amount, status")
      .in("deposit_id", ids);
    for (const a of apps ?? []) {
      if (((a.status as string) ?? "active") === "void") continue;
      const id = a.deposit_id as string;
      appliedBy.set(id, (appliedBy.get(id) ?? 0) + (Number(a.amount) || 0));
    }
  }

  let available = 0;
  let applied = 0;
  let voided = 0;
  for (const d of deposits) {
    const used = Math.round((appliedBy.get(d.id) ?? 0) * 100) / 100;
    if (d.status === "void") {
      voided += d.amount;
      continue;
    }
    applied += used;
    available += Math.max(0, d.amount - used);
  }

  return {
    available: Math.round(available * 100) / 100,
    applied: Math.round(applied * 100) / 100,
    voided: Math.round(voided * 100) / 100,
    deposits,
  };
}

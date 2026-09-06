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

  let available = 0;
  let applied = 0;
  let voided = 0;
  for (const d of deposits) {
    if (d.status === "unapplied") available += d.amount;
    else if (d.status === "applied") applied += d.amount;
    else if (d.status === "void") voided += d.amount;
  }

  return {
    available: Math.round(available * 100) / 100,
    applied: Math.round(applied * 100) / 100,
    voided: Math.round(voided * 100) / 100,
    deposits,
  };
}

import { createClient } from "@/lib/supabase/server";

export type AchPullListRow = {
  id: string;
  amount: number;
  status: string;
  account_last4: string;
  account_type: string;
  account_holder: string;
  created_at: string;
};

export async function listAchPulls(invoiceId: string): Promise<AchPullListRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ach_pulls")
    .select("id, amount, status, account_last4, account_type, account_holder, created_at")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !data) return [];
  return data as AchPullListRow[];
}

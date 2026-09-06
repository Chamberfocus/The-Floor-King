/**
 * F6-P2B opening balance data access (admin/office read; mutations via RPCs).
 */
import { createClient } from "@/lib/supabase/server";
import type { OpeningBatchStatus } from "@/lib/accounting/opening-balances";

export async function getLatestOpeningBalanceBatch() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("opening_balance_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as
    | {
        id: string;
        as_of_date: string;
        status: OpeningBatchStatus;
        description: string;
        journal_entry_id: string | null;
        posted_at: string | null;
        voided_at: string | null;
      }
    | null;
}

export async function getOpeningBalanceBatch(batchId: string) {
  const supabase = await createClient();
  const { data: batch, error } = await supabase
    .from("opening_balance_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!batch) return null;

  const [{ data: lines }, { data: ar }, { data: ap }] = await Promise.all([
    supabase
      .from("opening_balance_lines")
      .select("id, account_id, signed_amount, note, sort_order")
      .eq("batch_id", batchId)
      .order("sort_order"),
    supabase
      .from("opening_ar_items")
      .select(
        "id, customer_id, amount, due_date, as_of_date, legacy_invoice_number, reference, job_id, note, status",
      )
      .eq("batch_id", batchId)
      .eq("status", "active"),
    supabase
      .from("opening_ap_items")
      .select(
        "id, vendor_id, amount, bill_date, due_date, as_of_date, legacy_bill_number, reference, note, status",
      )
      .eq("batch_id", batchId)
      .eq("status", "active"),
  ]);

  return {
    batch: batch as {
      id: string;
      as_of_date: string;
      status: OpeningBatchStatus;
      description: string;
      journal_entry_id: string | null;
    },
    lines: lines ?? [],
    arItems: ar ?? [],
    apItems: ap ?? [],
  };
}

export async function listPostedOpeningArItems() {
  const supabase = await createClient();
  const { data: posted } = await supabase
    .from("opening_balance_batches")
    .select("id")
    .eq("status", "posted")
    .maybeSingle();
  if (!posted?.id) return [];
  const { data, error } = await supabase
    .from("opening_ar_items")
    .select(
      "id, amount, due_date, as_of_date, legacy_invoice_number, status, customer_id",
    )
    .eq("batch_id", posted.id)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listPostedOpeningApItems() {
  const supabase = await createClient();
  const { data: posted } = await supabase
    .from("opening_balance_batches")
    .select("id")
    .eq("status", "posted")
    .maybeSingle();
  if (!posted?.id) return [];
  const { data, error } = await supabase
    .from("opening_ap_items")
    .select(
      "id, amount, due_date, bill_date, as_of_date, legacy_bill_number, status, vendor_id",
    )
    .eq("batch_id", posted.id)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  return data ?? [];
}

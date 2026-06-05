import { createClient } from "@/lib/supabase/server";
import type { PoItem, PurchaseOrder } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function attachItems(
  supabase: SupabaseServerClient,
  pos: PurchaseOrder[],
): Promise<PurchaseOrder[]> {
  if (!pos.length) return pos;
  const ids = pos.map((p) => p.id);
  const { data } = await supabase
    .from("po_items")
    .select("*")
    .in("po_id", ids)
    .order("position", { ascending: true });
  const items = (data ?? []) as PoItem[];
  const byPo = new Map<string, PoItem[]>();
  for (const it of items) {
    const arr = byPo.get(it.po_id) ?? [];
    arr.push(it);
    byPo.set(it.po_id, arr);
  }
  for (const p of pos) p.items = byPo.get(p.id) ?? [];
  return pos;
}

export async function getPurchaseOrder(
  id: string,
): Promise<PurchaseOrder | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [po] = await attachItems(supabase, [data as PurchaseOrder]);
  return po;
}

export interface PoListRow extends PurchaseOrder {
  customer_name: string | null;
}

export async function listPurchaseOrders(): Promise<PoListRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*, customer:customers(full_name)")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as (PurchaseOrder & {
    customer?: { full_name: string | null } | null;
  })[];
  const list: PoListRow[] = rows.map((r) => ({
    ...r,
    customer_name: r.customer?.full_name ?? null,
  }));
  await attachItems(supabase, list);
  return list;
}

export async function listPurchaseOrdersForCustomer(
  customerId: string,
): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return attachItems(supabase, (data ?? []) as PurchaseOrder[]);
}

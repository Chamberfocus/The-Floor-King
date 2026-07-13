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

export interface JobAttribution {
  job_id: string;
  customer_id: string | null;
  label: string;
}

/**
 * Active jobs (with client names) to attribute a shared-order PO line to, so
 * material for another client on the same order stays trackable.
 */
export async function listJobsForAttribution(): Promise<JobAttribution[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select("id, title, customer_id, status, customer:customers(full_name)")
    .neq("status", "completed")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as {
    id: string;
    title: string | null;
    customer_id: string | null;
    customer?: { full_name: string | null } | { full_name: string | null }[] | null;
  }[];
  return rows.map((r) => {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    return {
      job_id: r.id,
      customer_id: r.customer_id,
      label: [c?.full_name, r.title].filter(Boolean).join(" — ") || "Job",
    };
  });
}

export interface AttributedPoLine {
  id: string;
  po_id: string;
  description: string;
  quantity: number | null;
  unit: string;
  manufacturer: string | null;
  color: string | null;
  note: string | null;
  po_supplier: string | null;
  primary_customer_name: string | null;
}

/**
 * PO lines from OTHER customers' purchase orders that were attributed to this
 * customer (a shared order) — so this client's material is always trackable
 * even when it rode along on someone else's PO.
 */
export async function listAttributedPoItemsForCustomer(
  customerId: string,
): Promise<AttributedPoLine[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("po_items")
    .select(
      "id, po_id, description, quantity, unit, manufacturer, color, note, po:purchase_orders(supplier, customer_id, customer:customers(full_name))",
    )
    .eq("for_customer_id", customerId);
  const rows = (data ?? []) as {
    id: string;
    po_id: string;
    description: string;
    quantity: number | null;
    unit: string;
    manufacturer: string | null;
    color: string | null;
    note: string | null;
    po?:
      | {
          supplier: string | null;
          customer_id: string | null;
          customer?: { full_name: string | null } | { full_name: string | null }[] | null;
        }
      | Array<{
          supplier: string | null;
          customer_id: string | null;
          customer?: { full_name: string | null } | { full_name: string | null }[] | null;
        }>
      | null;
  }[];
  return rows
    .map((r) => {
      const po = Array.isArray(r.po) ? r.po[0] : r.po;
      const cust = Array.isArray(po?.customer) ? po?.customer[0] : po?.customer;
      return {
        id: r.id,
        po_id: r.po_id,
        description: r.description,
        quantity: r.quantity,
        unit: r.unit,
        manufacturer: r.manufacturer,
        color: r.color,
        note: r.note,
        po_supplier: po?.supplier ?? null,
        po_customer_id: po?.customer_id ?? null,
        primary_customer_name: cust?.full_name ?? null,
      };
    })
    // Only the truly shared ones — a line pointing back at its own PO's customer
    // already shows under that PO.
    .filter((r) => r.po_customer_id !== customerId)
    .map(({ po_customer_id: _drop, ...rest }) => rest);
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

/** Purchase orders tied to a specific job (for the job's Documents tab). */
export async function listPurchaseOrdersForJob(
  jobId: string,
): Promise<PurchaseOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  return attachItems(supabase, (data ?? []) as PurchaseOrder[]);
}

export interface StockPull {
  product_id: string;
  name: string;
  qty: number;
  unit: string;
}

/**
 * What this customer's jobs have pulled from our own inventory (the third
 * material source, alongside manufacturer/distributor POs). Aggregated per
 * product so the customer file shows a clear "from stock" picture.
 */
export async function getCustomerStockPulls(
  customerId: string,
): Promise<StockPull[]> {
  const supabase = await createClient();
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", customerId);
  const jobIds = (jobs ?? []).map((j) => j.id as string);
  if (!jobIds.length) return [];

  const { data: moves } = await supabase
    .from("stock_movements")
    .select("product_id, qty, kind")
    .in("job_id", jobIds)
    .eq("kind", "pull");
  const byProduct = new Map<string, number>();
  for (const m of moves ?? []) {
    const pid = m.product_id as string | null;
    if (!pid) continue;
    byProduct.set(pid, (byProduct.get(pid) ?? 0) + Math.abs(Number(m.qty) || 0));
  }
  if (!byProduct.size) return [];

  const ids = [...byProduct.keys()];
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, unit")
    .in("id", ids);
  const meta = new Map(
    (prods ?? []).map((p) => [
      p.id as string,
      { name: (p.name as string) ?? "Item", unit: (p.unit as string) ?? "" },
    ]),
  );
  return ids.map((id) => ({
    product_id: id,
    name: meta.get(id)?.name ?? "Item",
    qty: Math.round((byProduct.get(id) ?? 0) * 100) / 100,
    unit: meta.get(id)?.unit ?? "",
  }));
}

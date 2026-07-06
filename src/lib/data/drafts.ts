import { createClient } from "@/lib/supabase/server";

export type DraftType = "estimate" | "po" | "invoice";

export interface DraftItem {
  type: DraftType;
  id: string;
  title: string;
  customer: string | null;
  updatedAt: string;
  href: string;
}

type Embed = { full_name: string | null } | { full_name: string | null }[] | null;
function custName(c: Embed): string | null {
  if (!c) return null;
  const one = Array.isArray(c) ? c[0] : c;
  return one?.full_name ?? null;
}

/**
 * Every unfinished (draft) estimate, purchase order, and invoice the user can
 * see — the "Saved for later" work list. RLS scopes visibility per user.
 */
export async function listMyDrafts(): Promise<DraftItem[]> {
  const supabase = await createClient();
  const [est, po, inv] = await Promise.all([
    supabase
      .from("estimates")
      .select("id, title, updated_at, customer:customers(full_name)")
      .eq("status", "draft")
      .order("updated_at", { ascending: false }),
    supabase
      .from("purchase_orders")
      .select("id, supplier, updated_at, customer:customers(full_name)")
      .eq("status", "draft")
      .order("updated_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, number, updated_at, customer:customers(full_name)")
      .eq("status", "draft")
      .order("updated_at", { ascending: false }),
  ]);

  const items: DraftItem[] = [];
  for (const e of est.data ?? []) {
    items.push({
      type: "estimate",
      id: e.id as string,
      title: (e.title as string) || "Untitled estimate",
      customer: custName(e.customer as Embed),
      updatedAt: e.updated_at as string,
      href: `/estimates/${e.id}/edit`,
    });
  }
  for (const p of po.data ?? []) {
    items.push({
      type: "po",
      id: p.id as string,
      title: p.supplier ? `PO — ${p.supplier}` : "Purchase order",
      customer: custName(p.customer as Embed),
      updatedAt: p.updated_at as string,
      href: `/purchase-orders/${p.id}`,
    });
  }
  for (const i of inv.data ?? []) {
    items.push({
      type: "invoice",
      id: i.id as string,
      title: i.number ? `Invoice ${i.number}` : "Invoice (draft)",
      customer: custName(i.customer as Embed),
      updatedAt: i.updated_at as string,
      href: `/invoices/${i.id}`,
    });
  }

  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return items;
}

"use server";

import { createClient } from "@/lib/supabase/server";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/types";

export type HitType = "customer" | "estimate" | "invoice" | "po" | "job" | "product";

export interface QuickHit {
  type: HitType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
export interface QuickGroup {
  type: HitType;
  label: string;
  hits: QuickHit[];
}
export interface QuickResults {
  query: string;
  groups: QuickGroup[];
  total: number;
}

const GROUP_LABEL: Record<HitType, string> = {
  customer: "Customers",
  estimate: "Estimates",
  invoice: "Invoices",
  po: "Purchase Orders",
  job: "Work Orders",
  product: "Catalog",
};
// Display order of the groups.
const GROUP_ORDER: HitType[] = ["customer", "estimate", "invoice", "po", "job", "product"];

type Row = Record<string, unknown>;
// Minimal chainable shape of the query builder for dynamically-built queries.
interface LooseBuilder {
  select(cols: string): LooseBuilder;
  or(filter: string): LooseBuilder;
  ilike(col: string, val: string): LooseBuilder;
  limit(n: number): PromiseLike<{ data: Row[] | null; error: unknown }>;
}
interface LooseFrom {
  from(table: string): LooseBuilder;
}
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}
function custName(r: Row): string | null {
  const c = one(r.customers as object) as { full_name?: string } | null;
  return c?.full_name ?? null;
}
function dot(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Smart, typed search across the whole CRM. Returns hits grouped by what they
 * are — customers, estimates, invoices, purchase orders, work orders, and
 * catalog items — each a direct link to that record. RLS scopes results to what
 * the signed-in user may see. `limit` is per group (small for the live
 * dropdown, larger for the full results page).
 */
export async function quickSearch(qRaw: string, limit = 6): Promise<QuickResults> {
  const q = (qRaw ?? "").trim();
  if (q.length < 2) return { query: q, groups: [], total: 0 };

  const supabase = await createClient();
  const like = `%${q}%`;

  // Dynamic table names + a built select string defeat the typed client's
  // literal-string parser, so reach it through a small structural interface.
  const sb = supabase as unknown as LooseFrom;

  // A "document" lives under a customer: match its own fields OR the customer's
  // name (two queries, merged) so "Smith" surfaces Smith's invoices/POs too.
  async function docs(
    table: string,
    ownOr: string,
    extraCols: string,
  ): Promise<Row[]> {
    const cols = `id, status, ${extraCols}`;
    const [own, byCust] = await Promise.all([
      sb.from(table).select(`${cols}, customers(full_name)`).or(ownOr).limit(limit),
      sb
        .from(table)
        .select(`${cols}, customers!inner(full_name)`)
        .ilike("customers.full_name", like)
        .limit(limit),
    ]);
    const seen = new Map<string, Row>();
    for (const r of [...(own.data ?? []), ...(byCust.data ?? [])]) {
      seen.set(r.id as string, r as Row);
    }
    return Array.from(seen.values()).slice(0, limit);
  }

  const [custRes, estRows, invRows, poRows, jobRows, prodRes] = await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name, company, phone, city")
      .or(
        [
          `full_name.ilike.${like}`,
          `company.ilike.${like}`,
          `email.ilike.${like}`,
          `phone.ilike.${like}`,
          `city.ilike.${like}`,
        ].join(","),
      )
      .limit(limit),
    docs("estimates", `title.ilike.${like}`, "title"),
    docs("invoices", `number.ilike.${like}`, "number"),
    docs("purchase_orders", `supplier.ilike.${like},notes.ilike.${like}`, "supplier"),
    docs("jobs", `title.ilike.${like}`, "title"),
    supabase
      .from("products")
      .select("id, name, sku, category")
      .or(
        [
          `name.ilike.${like}`,
          `sku.ilike.${like}`,
          `manufacturer.ilike.${like}`,
          `style.ilike.${like}`,
          `color.ilike.${like}`,
        ].join(","),
      )
      .limit(limit),
  ]);

  const byType: Record<HitType, QuickHit[]> = {
    customer: (custRes.data ?? []).map((c: Row) => ({
      type: "customer",
      id: c.id as string,
      title: (c.full_name as string) || "Customer",
      subtitle: dot([c.company as string, c.city as string, c.phone as string]),
      href: `/customers/${c.id}`,
    })),
    estimate: estRows.map((r) => ({
      type: "estimate",
      id: r.id as string,
      title: (r.title as string) || "Estimate",
      subtitle: dot([custName(r), title(String(r.status ?? ""))]),
      href: `/estimates/${r.id}`,
    })),
    invoice: invRows.map((r) => ({
      type: "invoice",
      id: r.id as string,
      title: r.number ? `Invoice #${r.number}` : "Invoice",
      subtitle: dot([custName(r), title(String(r.status ?? ""))]),
      href: `/invoices/${r.id}`,
    })),
    po: poRows.map((r) => ({
      type: "po",
      id: r.id as string,
      title: (r.supplier as string) || "Purchase order",
      subtitle: dot([custName(r), title(String(r.status ?? ""))]),
      href: `/purchase-orders/${r.id}`,
    })),
    job: jobRows.map((r) => ({
      type: "job",
      id: r.id as string,
      title: (r.title as string) || "Work order",
      subtitle: dot([custName(r), title(String(r.status ?? ""))]),
      href: `/jobs/${r.id}`,
    })),
    product: (prodRes.data ?? []).map((p: Row) => ({
      type: "product",
      id: p.id as string,
      title: (p.name as string) || "Product",
      subtitle: dot([
        PRODUCT_CATEGORY_LABELS[p.category as keyof typeof PRODUCT_CATEGORY_LABELS],
        p.sku ? `SKU ${p.sku}` : null,
      ]),
      href: `/catalog/${p.id}`,
    })),
  };

  const groups: QuickGroup[] = GROUP_ORDER.map((t) => ({
    type: t,
    label: GROUP_LABEL[t],
    hits: byType[t],
  })).filter((g) => g.hits.length > 0);

  const total = groups.reduce((n, g) => n + g.hits.length, 0);
  return { query: q, groups, total };
}

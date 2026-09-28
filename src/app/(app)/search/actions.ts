"use server";

import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { parsePoNumberQuery, sanitizeIlikeQuery } from "@/lib/ops-followup";
import {
  phoneSearchPattern,
  searchTypesForRole,
  type SearchHitType,
} from "@/lib/search-query";
import { PRODUCT_CATEGORY_LABELS } from "@/lib/types";

export type HitType = SearchHitType;

export interface QuickHit {
  type: HitType;
  id: string;
  title: string;
  subtitle: string;
  /** Second line of context. Never a dollar amount. */
  detail?: string;
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
  job: "Jobs",
  service: "Service",
  order: "Orders",
  invoice: "Invoices",
  po: "Purchase orders",
  product: "Catalog",
};
const GROUP_ORDER: HitType[] = [
  "customer",
  "estimate",
  "job",
  "service",
  "order",
  "invoice",
  "po",
  "product",
];

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
function customerOf(r: Row): {
  full_name?: string;
  street?: string;
  city?: string;
  phone?: string;
} | null {
  return one(r.customers as object) as {
    full_name?: string;
    street?: string;
    city?: string;
    phone?: string;
  } | null;
}
function custName(r: Row): string | null {
  return customerOf(r)?.full_name ?? null;
}
function dot(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ");
}
const STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  unscheduled: "Not scheduled",
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  sent: "Sent",
  draft: "Draft",
  approved: "Approved",
  submitted: "Needs review",
  partial: "Partly paid",
  paid: "Paid",
  void: "Void",
  ordered: "Ordered",
  received: "Received",
  open: "Open",
  waiting: "Waiting",
  resolved: "Resolved",
  declined: "Declined",
  changes_requested: "Changes requested",
};
function plainStatus(s: string): string {
  const key = s.trim().toLowerCase();
  if (!key) return "";
  return STATUS_LABEL[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

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

  const profile = await getProfile();
  const allowed = new Set(profile ? searchTypesForRole(profile.role) : []);
  if (!allowed.size) return { query: q, groups: [], total: 0 };

  const supabase = await createClient();
  const safe = sanitizeIlikeQuery(q);
  const poNumber = allowed.has("po") ? parsePoNumberQuery(q) : null;
  const phone = allowed.has("customer") ? phoneSearchPattern(q) : null;
  if (safe.length < 2 && poNumber == null && !phone) {
    return { query: q, groups: [], total: 0 };
  }
  const like = `%${safe}%`;

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
    const embed = "customers(full_name, street, city, phone)";
    const embedInner = "customers!inner(full_name, street, city, phone)";
    const [own, byCust] = await Promise.all([
      sb.from(table).select(`${cols}, ${embed}`).or(ownOr).limit(limit),
      sb.from(table).select(`${cols}, ${embedInner}`).ilike("customers.full_name", like).limit(limit),
    ]);
    const seen = new Map<string, Row>();
    for (const r of [...(own.data ?? []), ...(byCust.data ?? [])]) {
      seen.set(r.id as string, r as Row);
    }
    return Array.from(seen.values()).slice(0, limit);
  }

  const customerOr = [
    `full_name.ilike.${like}`,
    `company.ilike.${like}`,
    `email.ilike.${like}`,
    `phone.ilike.${like}`,
    `city.ilike.${like}`,
    `street.ilike.${like}`,
    `zip.ilike.${like}`,
  ];
  if (phone) customerOr.push(`phone.ilike.${phone}`);

  const emptyRows = Promise.resolve([] as Row[]);
  const [custRes, estRows, jobRows, serviceRows, orderRows, invRows, poRows, prodRes] = await Promise.all([
    allowed.has("customer")
      ? supabase
          .from("customers")
          .select("id, full_name, company, phone, city, street, zip, email")
          .or(customerOr.join(","))
          .limit(limit)
      : Promise.resolve({ data: [] as Row[] }),
    allowed.has("estimate") ? docs("estimates", `title.ilike.${like}`, "title") : emptyRows,
    allowed.has("job")
      ? docs("jobs", `title.ilike.${like},site_street.ilike.${like},site_city.ilike.${like}`, "title, site_street, site_city")
      : emptyRows,
    allowed.has("service")
      ? docs("service_callbacks", `description.ilike.${like}`, "description, category")
      : emptyRows,
    allowed.has("order")
      ? docs(
          "orders",
          `contact_name.ilike.${like},contact_phone.ilike.${like},contact_email.ilike.${like}`,
          "contact_name, contact_phone",
        )
      : emptyRows,
    allowed.has("invoice") ? docs("invoices", `number.ilike.${like}`, "number") : emptyRows,
    allowed.has("po")
      ? docs("purchase_orders", `supplier.ilike.${like},notes.ilike.${like}`, "supplier, po_number")
      : emptyRows,
    allowed.has("product")
      ? supabase
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
          .limit(limit)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  let poHits = poRows;
  if (poNumber != null && allowed.has("po")) {
    const { data: byNum } = await supabase
      .from("purchase_orders")
      .select("id, status, supplier, po_number, customers(full_name)")
      .eq("po_number", poNumber)
      .limit(limit);
    const seen = new Map<string, Row>();
    for (const r of [...poRows, ...((byNum ?? []) as Row[])]) {
      seen.set(r.id as string, r);
    }
    poHits = Array.from(seen.values()).slice(0, limit);
  }

  const byType: Record<HitType, QuickHit[]> = {
    customer: (custRes.data ?? []).map((c: Row) => ({
      type: "customer",
      id: c.id as string,
      title: (c.full_name as string) || "Customer",
      subtitle: dot([
        c.company as string,
        c.street as string,
        c.city as string,
        c.phone as string,
        c.email as string,
      ]),
      href: `/customers/${c.id}`,
    })),
    estimate: estRows.map((r) => {
      const customer = customerOf(r);
      return {
        type: "estimate" as const,
        id: r.id as string,
        title: (r.title as string) || "Estimate",
        subtitle: customer?.full_name || "Estimate",
        detail: dot([customer?.street, customer?.city, plainStatus(String(r.status ?? ""))]),
        href: `/estimates/${r.id}`,
      };
    }),
    order: orderRows.map((r) => {
      const customer = customerOf(r);
      return {
        type: "order" as const,
        id: r.id as string,
        title: (r.contact_name as string) || customer?.full_name || "Order",
        subtitle: dot([
          r.contact_name && customer?.full_name !== r.contact_name ? customer?.full_name : null,
          (r.contact_phone as string) || customer?.phone,
        ]),
        detail: dot([customer?.street, customer?.city, plainStatus(String(r.status ?? ""))]),
        href: `/orders?focus=${r.id}#order-${r.id}`,
      };
    }),
    invoice: invRows.map((r) => {
      const customer = customerOf(r);
      return {
        type: "invoice" as const,
        id: r.id as string,
        title: r.number ? `Invoice #${r.number}` : "Invoice",
        subtitle: customer?.full_name || "Invoice",
        detail: dot([customer?.street, customer?.city, plainStatus(String(r.status ?? ""))]),
        href: `/invoices/${r.id}`,
      };
    }),
    po: poHits.map((r) => {
      const customer = customerOf(r);
      return {
        type: "po" as const,
        id: r.id as string,
        title: r.po_number
          ? `PO ${r.po_number}${r.supplier ? ` — ${r.supplier}` : ""}`
          : (r.supplier as string) || "Purchase order",
        subtitle: customer?.full_name || (r.supplier as string) || "Purchase order",
        detail: dot([customer?.street, customer?.city, plainStatus(String(r.status ?? ""))]),
        href: `/purchase-orders/${r.id}`,
      };
    }),
    service: serviceRows.map((r) => {
      const customer = customerOf(r);
      const description = ((r.description as string) || "").trim();
      return {
        type: "service" as const,
        id: r.id as string,
        title: customer?.full_name || "Service issue",
        subtitle: description.length > 80 ? `${description.slice(0, 77)}…` : description,
        detail: plainStatus(String(r.status ?? "")),
        href: `/service/${r.id}`,
      };
    }),
    job: jobRows.map((r) => {
      const customer = customerOf(r);
      const scope = (r.title as string) || "";
      const who = customer?.full_name || "";
      return {
        type: "job" as const,
        id: r.id as string,
        title: who || scope || "Job",
        subtitle: who && scope && scope !== who ? scope : "",
        detail: dot([
          (r.site_street as string) || customer?.street,
          (r.site_city as string) || customer?.city,
          plainStatus(String(r.status ?? "")),
        ]),
        href: `/jobs/${r.id}`,
      };
    }),
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

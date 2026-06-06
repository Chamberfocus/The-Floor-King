import { createClient } from "@/lib/supabase/server";

export interface SearchHit {
  customerId: string;
  name: string;
  company: string | null;
  phone: string | null;
  city: string | null;
  reasons: string[];
}

interface CustRef {
  id: string;
  full_name: string;
  company: string | null;
  phone: string | null;
  city: string | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

/**
 * One search box for the whole CRM. Finds customers by their own details AND
 * by anything tied to them (estimate items, invoices). RLS scopes results to
 * what the signed-in user is allowed to see (e.g. a salesman sees only theirs).
 */
export async function searchCrm(qRaw: string): Promise<SearchHit[]> {
  const q = qRaw.trim();
  if (q.length < 2) return [];
  const supabase = await createClient();
  const like = `%${q}%`;

  const hits = new Map<string, SearchHit>();
  const add = (c: CustRef | null, reason: string) => {
    if (!c?.id) return;
    const h =
      hits.get(c.id) ??
      ({
        customerId: c.id,
        name: c.full_name,
        company: c.company,
        phone: c.phone,
        city: c.city,
        reasons: [],
      } satisfies SearchHit);
    if (reason && !h.reasons.includes(reason)) h.reasons.push(reason);
    hits.set(c.id, h);
  };

  // 1) Customers — name, company, contact, address, notes.
  const { data: custs } = await supabase
    .from("customers")
    .select("id, full_name, company, phone, city, email, street, zip, notes")
    .or(
      [
        `full_name.ilike.${like}`,
        `company.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`,
        `street.ilike.${like}`,
        `city.ilike.${like}`,
        `zip.ilike.${like}`,
        `notes.ilike.${like}`,
      ].join(","),
    )
    .limit(50);
  for (const c of custs ?? []) add(c as CustRef, "Customer details");

  // 2) Estimate line items — room / description (style, color, item # live here
  //    today as free text; structured fields arrive in a later phase).
  const { data: lines } = await supabase
    .from("estimate_line_items")
    .select(
      "description, room, manufacturer, style, color, item_no, estimate_options!inner ( estimates!inner ( customers!inner ( id, full_name, company, phone, city ) ) )",
    )
    .or(
      [
        `description.ilike.${like}`,
        `room.ilike.${like}`,
        `manufacturer.ilike.${like}`,
        `style.ilike.${like}`,
        `color.ilike.${like}`,
        `item_no.ilike.${like}`,
      ].join(","),
    )
    .limit(50);
  for (const l of lines ?? []) {
    const eo = one(
      (l as { estimate_options?: unknown }).estimate_options as object,
    ) as { estimates?: unknown } | null;
    const est = one(eo?.estimates as object) as { customers?: unknown } | null;
    const c = one(est?.customers as object) as CustRef | null;
    const li = l as {
      description?: string;
      room?: string;
      manufacturer?: string;
      style?: string;
      color?: string;
      item_no?: string;
    };
    const label =
      [li.manufacturer, li.style, li.color, li.item_no]
        .filter(Boolean)
        .join(" ") ||
      li.description ||
      li.room ||
      "line item";
    add(c, `Estimate: ${label}`);
  }

  // 3) Invoices — by invoice number.
  const { data: invs } = await supabase
    .from("invoices")
    .select(
      "number, customers!inner ( id, full_name, company, phone, city )",
    )
    .ilike("number", like)
    .limit(25);
  for (const i of invs ?? []) {
    const c = one((i as { customers?: unknown }).customers as object) as CustRef | null;
    add(c, `Invoice #${(i as { number?: string }).number ?? ""}`);
  }

  return Array.from(hits.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

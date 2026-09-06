import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginate";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import type { EstimateLineItem } from "@/lib/types";

/**
 * One customer's whole story, in time order.
 *
 * The customer file already had estimates, jobs, invoices and activity — each in
 * its own tab. That's fine for a homeowner with one job. It falls apart on a
 * commercial account with several properties, where the question is "what have
 * we done for these people, where, and did we make money", and answering it
 * means opening four tabs and holding dates in your head.
 *
 * Grouped by PROPERTY where a service address is set, because that is how a
 * landlord or builder thinks about their own account.
 */

export type HistoryKind =
  | "estimate"
  | "job"
  | "invoice"
  | "payment";

export interface HistoryEvent {
  kind: HistoryKind;
  id: string;
  at: string;
  title: string;
  status: string | null;
  /** The money on this event: quoted, billed, or paid. */
  amount: number | null;
  href: string;
  /** Which property, when we know. */
  propertyId: string | null;
  propertyLabel: string | null;
  detail?: string | null;
  /** Every document this event can open — view, print, staging sheet, PDF. */
  links?: { label: string; href: string }[];
}

export interface HistoryProperty {
  id: string | null;
  label: string;
  events: HistoryEvent[];
  quoted: number;
  billed: number;
  paid: number;
  wonJobs: number;
}

export interface CustomerHistory {
  events: HistoryEvent[];
  properties: HistoryProperty[];
  totals: {
    quoted: number;
    won: number;
    billed: number;
    paid: number;
    outstanding: number;
    /** Quotes that turned into approved work, as a percentage. */
    winRate: number | null;
    firstSeen: string | null;
    lastSeen: string | null;
  };
}

const money = (n: number) => Math.round(n * 100) / 100;

export async function getCustomerHistory(
  customerId: string,
): Promise<CustomerHistory> {
  const supabase = await createClient();
  const empty: CustomerHistory = {
    events: [],
    properties: [],
    totals: {
      quoted: 0, won: 0, billed: 0, paid: 0, outstanding: 0,
      winRate: null, firstSeen: null, lastSeen: null,
    },
  };
  if (!customerId) return empty;

  const [{ data: ests }, { data: jobs }, { data: invs }, { data: addrs }] =
    await Promise.all([
      supabase
        .from("estimates")
        .select("id, title, status, created_at, sent_at, tax_rate, discount_kind, discount_value, service_address_id")
        .eq("customer_id", customerId),
      supabase
        .from("jobs")
        .select("id, title, status, created_at, scheduled_date, completed_at, estimate_id, service_address_id")
        .eq("customer_id", customerId),
      supabase
        .from("invoices")
        .select("id, number, status, issue_date, created_at, tax_rate, job_id")
        .eq("customer_id", customerId),
      supabase
        .from("service_addresses")
        .select("id, label, street, city, state, zip")
        .eq("customer_id", customerId),
    ]);

  const estimateIds = (ests ?? []).map((e) => e.id as string);
  const invoiceIds = (invs ?? []).map((i) => i.id as string);

  // Line items for estimate values, and invoice items + payments for the money.
  const [opts, lines, invItems, pays] = await Promise.all([
    estimateIds.length
      ? fetchAll<{ id: string; estimate_id: string }>((from, to) =>
          supabase.from("estimate_options").select("id, estimate_id")
            .in("estimate_id", estimateIds).range(from, to),
        )
      : Promise.resolve([]),
    Promise.resolve([] as EstimateLineItem[]),
    invoiceIds.length
      ? fetchAll<{ invoice_id: string; quantity: number | null; rate: number | null }>((from, to) =>
          supabase.from("invoice_items").select("invoice_id, quantity, rate")
            .in("invoice_id", invoiceIds).range(from, to),
        )
      : Promise.resolve([]),
    invoiceIds.length
      ? fetchAll<{
          id: string;
          invoice_id: string;
          amount: number | null;
          paid_at: string | null;
          method: string | null;
          status: string | null;
        }>((from, to) =>
          supabase
            .from("payments")
            .select("id, invoice_id, amount, paid_at, method, status")
            .in("invoice_id", invoiceIds)
            .range(from, to),
        )
      : Promise.resolve([]),
  ]);

  const optionIds = opts.map((o) => o.id);
  const allLines = optionIds.length
    ? await fetchAll<EstimateLineItem>((from, to) =>
        supabase.from("estimate_line_items").select("*")
          .in("option_id", optionIds).range(from, to),
      )
    : [];
  void lines;

  const linesByOption = new Map<string, EstimateLineItem[]>();
  for (const l of allLines) {
    const arr = linesByOption.get(l.option_id) ?? [];
    arr.push(l);
    linesByOption.set(l.option_id, arr);
  }
  const optsByEstimate = new Map<string, string[]>();
  for (const o of opts) {
    const arr = optsByEstimate.get(o.estimate_id) ?? [];
    arr.push(o.id);
    optsByEstimate.set(o.estimate_id, arr);
  }

  const addrById = new Map(
    (addrs ?? []).map((a) => [
      a.id as string,
      [a.label, a.street, [a.city, a.state].filter(Boolean).join(", "), a.zip]
        .filter(Boolean)
        .join(" · "),
    ]),
  );

  const events: HistoryEvent[] = [];

  for (const e of ests ?? []) {
    // The estimate's value: its first option, discounted and taxed — the number
    // the customer was actually shown.
    const optIds = optsByEstimate.get(e.id as string) ?? [];
    const first = optIds.length ? (linesByOption.get(optIds[0]) ?? []) : [];
    const t = optionTotalsWithDiscount(
      first, e.tax_rate as number, e.discount_kind as string, e.discount_value as number,
    );
    const sa = (e.service_address_id as string | null) ?? null;
    events.push({
      kind: "estimate",
      id: e.id as string,
      at: (e.sent_at as string) || (e.created_at as string),
      title: (e.title as string) || "Estimate",
      status: e.status as string,
      amount: money(t.total),
      href: `/estimates/${e.id}`,
      propertyId: sa,
      propertyLabel: sa ? (addrById.get(sa) ?? null) : null,
      links: [
        { label: "Open", href: `/estimates/${e.id}` },
        { label: "Customer copy", href: `/estimates/${e.id}?preview=1` },
        { label: "Print", href: `/estimates/${e.id}?print=1` },
        { label: "Edit", href: `/estimates/${e.id}/edit` },
      ],
    });
  }

  for (const j of jobs ?? []) {
    const sa = (j.service_address_id as string | null) ?? null;
    events.push({
      kind: "job",
      id: j.id as string,
      at: (j.completed_at as string) || (j.scheduled_date as string) || (j.created_at as string),
      title: (j.title as string) || "Job",
      status: j.status as string,
      amount: null,
      href: `/jobs/${j.id}`,
      propertyId: sa,
      propertyLabel: sa ? (addrById.get(sa) ?? null) : null,
      detail: j.completed_at
        ? "completed"
        : j.scheduled_date
          ? `install ${String(j.scheduled_date).slice(0, 10)}`
          : null,
      links: [
        { label: "Work order", href: `/jobs/${j.id}` },
        { label: "Staging sheet", href: `/jobs/${j.id}/staging-sheet` },
        { label: "Installer bill", href: `/jobs/${j.id}/bill` },
        { label: "Close-out", href: `/jobs/${j.id}/closeout` },
      ],
    });
  }

  const itemsByInvoice = new Map<string, { quantity: number | null; rate: number | null }[]>();
  for (const it of invItems) {
    const arr = itemsByInvoice.get(it.invoice_id) ?? [];
    arr.push(it);
    itemsByInvoice.set(it.invoice_id, arr);
  }
  const jobAddr = new Map(
    (jobs ?? []).map((j) => [j.id as string, (j.service_address_id as string | null) ?? null]),
  );

  for (const i of invs ?? []) {
    const its = itemsByInvoice.get(i.id as string) ?? [];
    const sub = its.reduce((s, x) => s + Number(x.quantity ?? 0) * Number(x.rate ?? 0), 0);
    const total = sub * (1 + Number(i.tax_rate ?? 0) / 100);
    const sa = i.job_id ? (jobAddr.get(i.job_id as string) ?? null) : null;
    events.push({
      kind: "invoice",
      id: i.id as string,
      at: (i.issue_date as string) || (i.created_at as string),
      title: `Invoice ${i.number ?? ""}`.trim(),
      status: i.status as string,
      amount: money(total),
      href: `/invoices/${i.id}`,
      propertyId: sa,
      propertyLabel: sa ? (addrById.get(sa) ?? null) : null,
      links: [
        { label: "Open", href: `/invoices/${i.id}` },
        { label: "Print", href: `/invoices/${i.id}?print=1` },
      ],
    });
  }

  const invJob = new Map((invs ?? []).map((i) => [i.id as string, (i.job_id as string | null) ?? null]));
  for (const p of pays) {
    const isVoid = ((p.status as string | null) ?? "active") === "void";
    const jid = invJob.get(p.invoice_id) ?? null;
    const sa = jid ? (jobAddr.get(jid) ?? null) : null;
    events.push({
      kind: "payment",
      id: p.id,
      at: p.paid_at || "",
      title: isVoid ? "Payment voided" : "Payment received",
      status: isVoid ? "void" : (p.method ?? null),
      // Void payments are audit history only — never cash collected.
      amount: isVoid ? 0 : money(Number(p.amount ?? 0)),
      href: `/invoices/${p.invoice_id}`,
      propertyId: sa,
      propertyLabel: sa ? (addrById.get(sa) ?? null) : null,
    });
  }

  // Newest first — the last thing that happened is what you want to see.
  events.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  // Group by property. Everything without one falls into a single bucket rather
  // than being hidden — an unattributed job is still work you did.
  const byProperty = new Map<string, HistoryEvent[]>();
  for (const ev of events) {
    const key = ev.propertyId ?? "";
    const arr = byProperty.get(key) ?? [];
    arr.push(ev);
    byProperty.set(key, arr);
  }
  const properties: HistoryProperty[] = [...byProperty.entries()]
    .map(([id, evs]) => ({
      id: id || null,
      label: id ? (addrById.get(id) ?? "Property") : "No property recorded",
      events: evs,
      quoted: money(evs.filter((e) => e.kind === "estimate").reduce((s, e) => s + (e.amount ?? 0), 0)),
      billed: money(evs.filter((e) => e.kind === "invoice").reduce((s, e) => s + (e.amount ?? 0), 0)),
      paid: money(
        evs
          .filter((e) => e.kind === "payment" && e.status !== "void")
          .reduce((s, e) => s + (e.amount ?? 0), 0),
      ),
      wonJobs: evs.filter((e) => e.kind === "job" && e.status === "completed").length,
    }))
    // Named properties first, the unattributed bucket last.
    .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || b.billed - a.billed);

  const estEvents = events.filter((e) => e.kind === "estimate");
  const wonEsts = estEvents.filter((e) => e.status === "approved");
  const quoted = money(estEvents.reduce((s, e) => s + (e.amount ?? 0), 0));
  const won = money(wonEsts.reduce((s, e) => s + (e.amount ?? 0), 0));
  const billed = money(events.filter((e) => e.kind === "invoice" && e.status !== "void")
    .reduce((s, e) => s + (e.amount ?? 0), 0));
  const paid = money(
    events
      .filter((e) => e.kind === "payment" && e.status !== "void")
      .reduce((s, e) => s + (e.amount ?? 0), 0),
  );
  // Only DECIDED quotes count toward a win rate — one still sitting in their
  // inbox is not a loss, and counting it as one flatters nothing and misleads.
  const decided = estEvents.filter((e) => e.status === "approved" || e.status === "declined").length;
  const dates = events.map((e) => e.at).filter(Boolean).sort();

  return {
    events,
    properties,
    totals: {
      quoted, won, billed, paid,
      outstanding: money(billed - paid),
      winRate: decided ? Math.round((wonEsts.length / decided) * 100) : null,
      firstSeen: dates[0] ?? null,
      lastSeen: dates[dates.length - 1] ?? null,
    },
  };
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_NAME } from "@/lib/nav";
import { formatCents, formatMarginHundredths, formatRateBps, marginHundredths, trueUpAccess } from "@/lib/job-true-up";
import { PrintButton } from "@/components/print-button";
import { PayBatch } from "../pay-batch";

export const metadata: Metadata = { title: "Commission statement" };
export const dynamic = "force-dynamic";

export default async function StatementPage({
  searchParams,
}: {
  searchParams: Promise<{ salesperson?: string; from?: string; to?: string; filter?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  const access = trueUpAccess(profile.role);
  if (!access.viewOwn && !access.viewAll) notFound();
  const sp = await searchParams;
  const salespersonId = access.viewAll ? sp.salesperson || profile.id : profile.id;
  const filter = sp.filter === "payable" || sp.filter === "paid" ? sp.filter : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 25;
  const supabase = await createClient();
  const { data: people } = access.viewAll
    ? await supabase.from("profiles").select("id, full_name").in("role", ["salesman", "sales_manager"]).order("full_name")
    : { data: [] };
  const { data, error } = await supabase.rpc("job_commission_statement", {
    p_salesperson: salespersonId,
    p_from: sp.from || null,
    p_to: sp.to || null,
    p_filter: filter,
    p_limit: limit,
    p_offset: (page - 1) * limit,
  });
  const { data: payable } = await supabase
    .from("job_commission_ledger")
    .select("id")
    .eq("salesperson_id", salespersonId)
    .eq("status", "payable")
    .limit(100);

  const body = (data ?? {}) as {
    totals?: Record<string, number>;
    rows?: Record<string, unknown>[];
    total_rows?: number;
  };
  const totals = body.totals ?? {};
  const rows = body.rows ?? [];
  const name = (people ?? []).find((p) => p.id === salespersonId)?.full_name ?? profile.full_name ?? "Salesperson";
  const gp = BigInt(totals.gp_cents ?? 0);
  const revenue = BigInt(totals.final_revenue_cents ?? 0);
  const missing = error && /does not exist|schema cache|42883/i.test(error.message);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/commissions" className="text-sm underline">True-up queue</Link>
        <PrintButton />
      </div>
      <article className="print:block">
        <header className="mb-4">
          <h1 className="text-2xl font-bold">{COMPANY_NAME}</h1>
          <p className="text-lg font-semibold">Commission statement — {name}</p>
          <p className="text-sm">
            Period {sp.from || "start"} to {sp.to || "today"} · Generated {new Date().toLocaleDateString("en-US")}
          </p>
        </header>
        {missing ? (
          <p className="text-sm">Apply migration 0481 before statements can be loaded. Nothing was written.</p>
        ) : null}
        <form className="mb-4 flex flex-wrap gap-2 print:hidden" action="/commissions/statement">
          {access.viewAll ? (
            <select name="salesperson" defaultValue={salespersonId} className="h-11 rounded-lg border bg-transparent px-3">
              {(people ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          ) : null}
          <input className="h-11 rounded-lg border px-3" type="date" name="from" defaultValue={sp.from ?? ""} />
          <input className="h-11 rounded-lg border px-3" type="date" name="to" defaultValue={sp.to ?? ""} />
          <select name="filter" defaultValue={filter} className="h-11 rounded-lg border bg-transparent px-3">
            <option value="all">All</option>
            <option value="payable">Payable</option>
            <option value="paid">Paid</option>
          </select>
          <button className="h-11 rounded-lg border px-4" type="submit">Apply</button>
        </form>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Jobs" value={String(totals.jobs ?? 0)} />
          <Stat label="Final revenue" value={money(totals.final_revenue_cents)} />
          <Stat label="Actual cost" value={money(totals.actual_cost_cents)} />
          <Stat label="Actual gross profit" value={money(totals.gp_cents)} />
          <Stat label="Weighted margin" value={formatMarginHundredths(marginHundredths(gp, revenue))} />
          <Stat label="Commission earned" value={money(totals.commission_earned_cents)} />
          <Stat label="Adjustments" value={money(totals.adjustment_cents)} />
          <Stat label="Paid" value={money(totals.paid_cents)} />
          <Stat label="Still owed" value={money(totals.owed_cents)} />
        </dl>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                {["Job", "Customer", "Completed", "Final sale", "Actual cost", "GP $", "PM %", "Commission %", "Commission $", "Approval", "Payment", "Paid", "Owed"].map((h) => (
                  <th key={h} className="px-2 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const payload = (row.payload ?? {}) as Record<string, unknown>;
                return (
                  <tr key={String(row.job_id)} className="border-b">
                    <td className="px-2 py-2">{String(row.title ?? "")}</td>
                    <td className="px-2 py-2">{String(row.customer_name ?? "")}</td>
                    <td className="px-2 py-2">{String(row.completed_at ?? "").slice(0, 10)}</td>
                    <td className="px-2 py-2">{money(payload.actual_revenue_cents)}</td>
                    <td className="px-2 py-2">{money(payload.actual_direct_cents)}</td>
                    <td className="px-2 py-2">{money(payload.actual_gp_cents)}</td>
                    <td className="px-2 py-2">{formatMarginHundredths(asBig(payload.actual_margin_hundredths))}</td>
                    <td className="px-2 py-2">{rate(payload.rate_bps)}</td>
                    <td className="px-2 py-2">{money(payload.commission_cents)}</td>
                    <td className="px-2 py-2">{String(row.approval_status ?? "").replaceAll("_", " ")}</td>
                    <td className="px-2 py-2">{String(row.payment_status ?? "").replaceAll("_", " ")}</td>
                    <td className="px-2 py-2">{money(row.paid_cents)}</td>
                    <td className="px-2 py-2">{money(row.owed_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm">
          Current payment covers the payable lines on this salesperson. Previously paid {money(totals.paid_cents)}. Remaining owed {money(totals.owed_cents)}.
        </p>
      </article>
      {access.markPaid ? (
        <PayBatch
          salespersonId={salespersonId}
          ledgerIds={(payable ?? []).map((r) => String((r as { id: string }).id))}
          periodStart={sp.from ?? ""}
          periodEnd={sp.to ?? ""}
        />
      ) : null}
      <p className="text-sm text-muted-foreground print:hidden">
        Page {page} of {Math.max(1, Math.ceil(Number(body.total_rows ?? 0) / limit))}. Statement totals above include every job in the filter, not only this page.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function rate(value: unknown): string {
  const bps = asBig(value);
  return bps == null ? "—" : formatRateBps(bps);
}

function asBig(value: unknown): bigint | null {
  if (value == null) return null;
  try {
    return BigInt(value as string | number);
  } catch {
    return null;
  }
}

function money(value: unknown): string {
  if (value == null) return "—";
  try {
    return formatCents(BigInt(value as string | number));
  } catch {
    return "—";
  }
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatMarginHundredths, marginHundredths, trueUpAccess } from "@/lib/job-true-up";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Job profitability" };
export const dynamic = "force-dynamic";

export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; salesperson?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!trueUpAccess(profile.role).ownerReport) notFound();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 25;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_true_up_profitability", {
    p_from: sp.from || null,
    p_to: sp.to || null,
    p_salesperson: sp.salesperson || null,
    p_limit: limit,
    p_offset: (page - 1) * limit,
  });
  const body = (data ?? {}) as { totals?: Record<string, number>; rows?: Record<string, unknown>[]; total_rows?: number };
  const totals = body.totals ?? {};
  const missing = error && /does not exist|schema cache|42883/i.test(error.message);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader title="Owner profitability" description="Actual gross profit after sales commission. This is not accounting net profit." />
      <Link href="/commissions" className="text-sm underline">Back to true-up</Link>
      {missing ? <p className="text-sm">Apply migration 0481 to load this report.</p> : null}
      <form className="flex flex-wrap gap-2" action="/commissions/profitability">
        <input className="h-11 rounded-lg border px-3" type="date" name="from" defaultValue={sp.from ?? ""} />
        <input className="h-11 rounded-lg border px-3" type="date" name="to" defaultValue={sp.to ?? ""} />
        <input className="h-11 rounded-lg border px-3" name="salesperson" defaultValue={sp.salesperson ?? ""} placeholder="Salesperson id" />
        <button className="h-11 rounded-lg border px-4" type="submit">Apply</button>
      </form>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Item label="Revenue" value={money(totals.revenue_cents)} />
        <Item label="Estimated cost" value={money(totals.estimated_cost_cents)} />
        <Item label="Actual cost" value={money(totals.actual_cost_cents)} />
        <Item label="Estimated GP" value={money(totals.estimated_gp_cents)} />
        <Item label="Actual GP" value={money(totals.actual_gp_cents)} />
        <Item label="Commission" value={money(totals.commission_cents)} />
        <Item label="GP after commission" value={money(totals.net_after_commission_cents)} />
        <Item
          label="Weighted actual margin"
          value={formatMarginHundredths(
            marginHundredths(BigInt(totals.actual_gp_cents ?? 0), BigInt(totals.revenue_cents ?? 0)),
          )}
        />
      </dl>
      <ul className="grid gap-2">
        {(body.rows ?? []).map((row) => {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          return (
            <li key={String(row.job_id)} className="rounded-xl border p-4 text-sm">
              <Link href={`/jobs/${row.job_id}/true-up`} className="font-medium hover:underline">
                {String(row.title ?? "Job")} — {String(row.customer_name ?? "")}
              </Link>
              <div>Revenue {money(payload.actual_revenue_cents)} · Actual GP {money(payload.actual_gp_cents)} · Commission {money(payload.commission_cents)}</div>
              <div>
                Estimated margin {formatMarginHundredths(asBig(payload.estimated_margin_hundredths))} · Actual margin {formatMarginHundredths(asBig(payload.actual_margin_hundredths))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground">
        {body.total_rows ?? 0} approved jobs. Page {page}. Totals stay on the full filter.
      </p>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function money(value: unknown): string {
  if (value == null) return "—";
  try {
    return formatCents(BigInt(value as string | number));
  } catch {
    return "—";
  }
}

function asBig(value: unknown): bigint | null {
  if (value == null) return null;
  try {
    return BigInt(value as string | number);
  } catch {
    return null;
  }
}

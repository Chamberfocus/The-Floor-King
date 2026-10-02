import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatMarginHundredths, marginHundredths, trueUpAccess } from "@/lib/job-true-up";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Salesperson results" };
export const dynamic = "force-dynamic";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!trueUpAccess(profile.role).performance) notFound();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("job_true_up_performance", {
    p_from: sp.from || null,
    p_to: sp.to || null,
    p_limit: 25,
    p_offset: (page - 1) * 25,
  });
  const body = (data ?? {}) as { rows?: Record<string, unknown>[]; total_rows?: number };
  const missing = error && /does not exist|schema cache|42883/i.test(error.message);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader title="Salesperson results" description="Factual job results. No subjective rating." />
      <Link href="/commissions" className="text-sm underline">Back to true-up</Link>
      {missing ? <p className="text-sm">Apply migration 0481 to load this report.</p> : null}
      <form className="flex flex-wrap gap-2" action="/commissions/performance">
        <input className="h-11 rounded-lg border px-3" type="date" name="from" defaultValue={sp.from ?? ""} />
        <input className="h-11 rounded-lg border px-3" type="date" name="to" defaultValue={sp.to ?? ""} />
        <button className="h-11 rounded-lg border px-4" type="submit">Apply</button>
      </form>
      <ul className="grid gap-3">
        {(body.rows ?? []).map((row) => {
          const revenue = BigInt((row.revenue_cents as number | string | undefined) ?? 0);
          const gp = BigInt((row.gp_cents as number | string | undefined) ?? 0);
          return (
            <li key={String(row.salesperson_id)} className="rounded-xl border p-4 text-sm">
              <div className="text-base font-semibold">{String(row.full_name ?? "Unassigned")}</div>
              <div>Jobs {String(row.jobs)} · Revenue {formatCents(revenue)} · Actual GP {formatCents(gp)}</div>
              <div>Weighted margin {formatMarginHundredths(marginHundredths(gp, revenue))}</div>
              <div>
                Commission earned {money(row.commission_cents)} · Paid {money(row.paid_cents)} · Owed {money(row.owed_cents)}
              </div>
              <div>Below 35% {String(row.under_35)} · 50%+ {String(row.at_50)}</div>
              <div>
                Average GP variance {formatCents(gp - BigInt((row.estimated_gp_cents as number | string | undefined) ?? 0))} across these jobs
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted-foreground">{body.total_rows ?? 0} salespeople. Page {page}.</p>
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

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BarChart3, Settings2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { PageHeader } from "@/components/page-header";
import { getSourceRoiReport } from "@/lib/data/lead-sources";
import { formatMoney } from "@/lib/format";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Lead sources & ROI" };
export const dynamic = "force-dynamic";

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export default async function LeadSourcesReportPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const today = new Date();
  const end = sp.end || isoDay(today);
  const start = sp.start || isoDay(new Date(today.getFullYear(), today.getMonth(), 1));

  const { rows, referrers, totals } = await getSourceRoiReport(
    `${start}T00:00:00`,
    `${end}T23:59:59`,
  );

  const preset = (label: string, s: Date, e: Date) => (
    <Link
      href={`/reports/lead-sources?start=${isoDay(s)}&end=${isoDay(e)}`}
      className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
    >
      {label}
    </Link>
  );
  const y = today.getFullYear();
  const m = today.getMonth();
  const qStart = new Date(y, Math.floor(m / 3) * 3, 1);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/reports"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Reports
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Lead sources & ROI"
          description="Where leads come from and what each source is worth — leads, jobs, revenue, and return on ad spend."
        />
        <Button render={<Link href="/settings/lead-sources" />} variant="outline" size="sm">
          <Settings2 className="size-4" /> Manage sources & spend
        </Button>
      </div>

      <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">From</label>
          <DateField name="start" defaultValue={start} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">To</label>
          <DateField name="end" defaultValue={end} />
        </div>
        <Button type="submit" variant="outline">Update</Button>
      </form>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {preset("This month", new Date(y, m, 1), today)}
        {preset("This quarter", qStart, today)}
        {preset("This year", new Date(y, 0, 1), today)}
        {preset("Last 12 mo", new Date(y - 1, m, 1), today)}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { k: "Leads", v: String(totals.leads) },
          { k: "Jobs", v: String(totals.jobs) },
          { k: "Revenue", v: formatMoney(totals.revenue) },
          { k: "Ad spend", v: formatMoney(totals.spend) },
          { k: "ROAS", v: totals.spend ? `${(totals.revenue / totals.spend).toFixed(1)}×` : "—" },
        ].map((t) => (
          <div key={t.k} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{t.k}</div>
            <div className="text-xl font-semibold tabular-nums">{t.v}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No leads in this period"
          description="Sources appear here as leads come in. Paste migration 0112 if this looks empty."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Source / detail</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Jobs</th>
                <th className="px-3 py-2 text-right">Conv.</th>
                <th className="px-3 py-2 text-right">Revenue</th>
                <th className="px-3 py-2 text-right">Avg job</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Cost/lead</th>
                <th className="px-3 py-2 text-right">Cost/job</th>
                <th className="px-3 py-2 text-right">ROAS</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={`${r.sourceId}-${r.detailId}`} className="tabular-nums">
                  <td className="px-3 py-2 text-left tabular-nums">
                    <span className="font-medium">{r.sourceLabel}</span>
                    {r.detailLabel ? <span className="text-muted-foreground"> · {r.detailLabel}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{r.leads}</td>
                  <td className="px-3 py-2 text-right">{r.jobs}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{pct(r.converted, r.leads)}%</td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(r.revenue)}</td>
                  <td className="px-3 py-2 text-right">{r.jobs ? formatMoney(r.revenue / r.jobs) : "—"}</td>
                  <td className="px-3 py-2 text-right">{r.spend ? formatMoney(r.spend) : "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{r.spend && r.leads ? formatMoney(r.spend / r.leads) : "—"}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{r.spend && r.jobs ? formatMoney(r.spend / r.jobs) : "—"}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {r.spend ? `${(r.revenue / r.spend).toFixed(1)}×` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {referrers.length ? (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold">Top referrers</h2>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[400px] text-sm">
              <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Referred by</th>
                  <th className="px-3 py-2 text-right">Leads</th>
                  <th className="px-3 py-2 text-right">Jobs</th>
                  <th className="px-3 py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {referrers.map((r) => (
                  <tr key={r.name} className="tabular-nums">
                    <td className="px-3 py-2 text-left font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right">{r.leads}</td>
                    <td className="px-3 py-2 text-right">{r.jobs}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-muted-foreground">
        Leads = customers created in the period. Jobs &amp; revenue = approved estimates.
        &ldquo;Not recorded&rdquo; = leads with no source (existing records aren&apos;t changed).
      </p>
    </div>
  );
}

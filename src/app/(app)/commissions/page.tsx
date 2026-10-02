import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCents, trueUpAccess } from "@/lib/job-true-up";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "True-up" };
export const dynamic = "force-dynamic";

const BUCKETS = [
  ["needs_true_up", "Needs true-up"],
  ["missing_costs", "Missing costs"],
  ["ready_for_review", "Ready for review"],
  ["approved", "Approved"],
  ["commission_payable", "Commission payable"],
  ["commission_paid", "Commission paid"],
] as const;

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!trueUpAccess(profile.role).viewAll) notFound();
  const sp = await searchParams;
  const bucket = BUCKETS.some(([id]) => id === sp.bucket) ? sp.bucket! : "needs_true_up";
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const supabase = await createClient();
  const [dash, list, count] = await Promise.all([
    supabase.rpc("job_true_up_dashboard"),
    supabase.rpc("list_job_true_up_queue", { p_bucket: bucket, p_limit: limit, p_offset: offset }),
    supabase.rpc("count_job_true_up_queue", { p_bucket: bucket }),
  ]);
  const missing = [dash.error, list.error, count.error].find((e) => e && /does not exist|schema cache|42883/i.test(e.message));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader title="Job true-up" description="Actual profitability and salesperson commission. Accounting stays off.">
        <Link href="/commissions/statement" className="text-sm underline">Statements</Link>
        <Link href="/commissions/profitability" className="text-sm underline">Profitability</Link>
        <Link href="/commissions/performance" className="text-sm underline">Salespeople</Link>
      </PageHeader>
      {missing ? (
        <p className="rounded-xl border p-4 text-sm">
          Apply supabase/migrations/0481_job_true_up.sql in the Supabase SQL editor before this queue can read or write true-ups. The migration has not been applied from this change.
        </p>
      ) : null}
      {dash.data ? <Dashboard data={dash.data as Record<string, number>} /> : null}
      <div className="flex flex-wrap gap-2">
        {BUCKETS.map(([id, label]) => (
          <Link
            key={id}
            href={`/commissions?bucket=${id}`}
            className={`inline-flex h-11 items-center rounded-full border px-4 text-sm ${id === bucket ? "bg-primary text-primary-foreground" : ""}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <ul className="grid gap-2">
        {((list.data ?? []) as { job_id: string; job_title: string; customer_name: string; status: string }[]).map((row) => (
          <li key={row.job_id}>
            <Link href={`/jobs/${row.job_id}/true-up`} className="flex items-center justify-between rounded-xl border p-4 hover:bg-muted/40">
              <span>
                <span className="font-medium">{row.job_title || "Job"}</span>
                <span className="block text-sm text-muted-foreground">{row.customer_name}</span>
              </span>
              <span className="text-sm">{row.status.replaceAll("_", " ")}</span>
            </Link>
          </li>
        ))}
        {!list.data?.length ? <li className="text-sm text-muted-foreground">Nothing in this list.</li> : null}
      </ul>
      <Pager page={page} total={Number(count.data ?? 0)} limit={limit} bucket={bucket} />
    </div>
  );
}

function Dashboard({ data }: { data: Record<string, number> }) {
  const cards: [string, string][] = [
    ["Needs true-up", String(data.needs_true_up ?? 0)],
    ["Missing costs", String(data.missing_costs ?? 0)],
    ["Ready for approval", String(data.ready_for_review ?? 0)],
    ["Commission payable", String(data.commission_payable ?? 0)],
    ["Commission owed", formatCents(BigInt(data.commission_owed_cents ?? 0))],
    ["Under 35%", String(data.jobs_under_35 ?? 0)],
    ["35–39.99%", String(data.jobs_35 ?? 0)],
    ["40–44.99%", String(data.jobs_40 ?? 0)],
    ["45–49.99%", String(data.jobs_45 ?? 0)],
    ["50%+", String(data.jobs_50 ?? 0)],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cards.map(([label, value]) => (
        <div key={label} className="rounded-xl border p-3">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Pager({ page, total, limit, bucket }: { page: number; total: number; limit: number; bucket: string }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{total} jobs. Totals do not change when you change pages.</span>
      <span className="flex gap-3">
        {page > 1 ? <Link href={`/commissions?bucket=${bucket}&page=${page - 1}`}>Previous</Link> : null}
        <span>Page {page} of {pages}</span>
        {page < pages ? <Link href={`/commissions?bucket=${bucket}&page=${page + 1}`}>Next</Link> : null}
      </span>
    </div>
  );
}

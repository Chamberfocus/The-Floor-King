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

const DESTINATIONS = [
  { id: "needs_true_up", label: "Needs true-up", href: "/commissions?bucket=needs_true_up" },
  { id: "in_progress", label: "In progress", href: "/commissions?bucket=in_progress" },
  { id: "approved", label: "Approved", href: "/commissions?bucket=approved" },
  { id: "statements", label: "Statements", href: "/commissions/statement" },
  { id: "profitability", label: "Profitability", href: "/commissions/profitability" },
] as const;

type QueueRow = { job_id: string; job_title: string; customer_name: string; status: string };

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!trueUpAccess(profile.role).viewAll) notFound();
  const sp = await searchParams;
  const bucket =
    sp.bucket === "in_progress" || BUCKETS.some(([id]) => id === sp.bucket) ? sp.bucket! : "needs_true_up";
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const supabase = await createClient();
  const inProgress = bucket === "in_progress";
  const [dash, list, count, readyList, readyCount] = await Promise.all([
    supabase.rpc("job_true_up_dashboard"),
    supabase.rpc("list_job_true_up_queue", {
      p_bucket: inProgress ? "missing_costs" : bucket,
      p_limit: limit,
      p_offset: offset,
    }),
    supabase.rpc("count_job_true_up_queue", { p_bucket: inProgress ? "missing_costs" : bucket }),
    inProgress
      ? supabase.rpc("list_job_true_up_queue", {
          p_bucket: "ready_for_review",
          p_limit: limit,
          p_offset: offset,
        })
      : Promise.resolve({ data: null, error: null }),
    inProgress
      ? supabase.rpc("count_job_true_up_queue", { p_bucket: "ready_for_review" })
      : Promise.resolve({ data: null, error: null }),
  ]);
  const missing = [dash.error, list.error, count.error, readyList.error, readyCount.error].find(
    (e) => e && /does not exist|schema cache|42883/i.test(e.message),
  );
  const rows = (list.data ?? []) as QueueRow[];
  const readyRows = (readyList.data ?? []) as QueueRow[];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
      <PageHeader
        title="Job true-up"
        description="Actual profitability and salesperson commission. Accounting stays off."
      />
      <nav aria-label="True-up" className="grid gap-2 sm:grid-cols-5">
        {DESTINATIONS.map((item) => {
          const active =
            item.id === "in_progress"
              ? bucket === "in_progress" || bucket === "missing_costs" || bucket === "ready_for_review"
              : item.id === bucket;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 items-center justify-center rounded-xl border px-3 text-center text-sm font-semibold ${
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted/40"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
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
        <Link href="/commissions/performance" className="inline-flex h-11 items-center rounded-full border px-4 text-sm">
          Salespeople
        </Link>
      </div>
      {inProgress ? (
        <div className="grid gap-6">
          <Queue title={`Missing costs (${Number(count.data ?? 0)})`} rows={rows} />
          <Queue title={`Ready for review (${Number(readyCount.data ?? 0)})`} rows={readyRows} />
        </div>
      ) : (
        <Queue rows={rows} />
      )}
      <Pager
        page={page}
        total={
          inProgress
            ? Math.max(Number(count.data ?? 0), Number(readyCount.data ?? 0))
            : Number(count.data ?? 0)
        }
        limit={limit}
        bucket={bucket}
      />
    </div>
  );
}

function Queue({ title, rows }: { title?: string; rows: QueueRow[] }) {
  return (
    <section className="grid gap-2">
      {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
      <ul className="grid gap-2">
        {rows.map((row) => (
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
        {!rows.length ? <li className="text-sm text-muted-foreground">Nothing in this list.</li> : null}
      </ul>
    </section>
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

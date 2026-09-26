import type { Metadata } from "next";
import { jobHeading, jobIdentityLine } from "@/lib/job-label";
import Link from "next/link";
import { Plus, MapPin, HardHat, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { WorkQueueBar, WorkQueuePager } from "@/components/work-queue-bar";
import { listJobsQueue, countInstallJobs, listAssignableUsers, claimRequestCounts } from "@/lib/data/jobs";
import { requireProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { shopTodayYmd } from "@/lib/job-snapshot";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";
import {
  jobQueueEmpty,
  jobQueueFact,
  jobQueueMine,
  parseJobQueue,
  parseListPage,
  resultCountLabel,
  type JobQueueView,
} from "@/lib/work-queues";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const QUEUE_CHIPS: { view: JobQueueView; label: string }[] = [
  { view: "open", label: "Open" },
  { view: "material", label: "Needs material" },
  { view: "ready", label: "Ready to schedule" },
  { view: "scheduled", label: "Scheduled" },
  { view: "installing", label: "In progress" },
  { view: "completed", label: "Completed" },
  { view: "service", label: "Service needed" },
  { view: "all", label: "All" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; q?: string; view?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const isStaff = profile.role === "admin" || profile.role === "office";
  const isCrew = profile.role === "crew";
  const q = sp.q?.trim() ?? "";
  const view = parseJobQueue(sp.view, profile.role);
  const mine = jobQueueMine(sp.who, profile.role);
  const defaultView: JobQueueView = profile.role === "scheduler" ? "ready" : "open";
  const todayYmd = shopTodayYmd();

  const [queue, mineCount, allCount, users, claims] = await Promise.all([
    listJobsQueue({
      queue: view,
      search: q,
      page: parseListPage(sp.page),
      assignedTo: isCrew ? profile.id : undefined,
      mineFor: !isCrew && mine ? profile.id : undefined,
    }),
    isCrew ? Promise.resolve(0) : countInstallJobs({ mineFor: profile.id }),
    isCrew ? Promise.resolve(0) : countInstallJobs(),
    isStaff ? listAssignableUsers() : Promise.resolve([]),
    isStaff ? claimRequestCounts() : Promise.resolve(new Map<string, number>()),
  ]);

  const jobs = queue.rows;
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));

  const jobHref = (next: { view?: JobQueueView; who?: "mine" | "all"; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const v = next.view ?? view;
    if (v !== defaultView) params.set("view", v);
    if (!isCrew) {
      const who = next.who ?? (mine ? "mine" : "all");
      if (who === "mine") params.set("who", "mine");
      else if (profile.role === "salesman") params.set("who", "all");
    }
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  const who = (j: Job) =>
    j.assigned_to ? (nameById.get(j.assigned_to) ?? "Assigned") : j.assigned_crew_id ? "Crew" : null;

  const StatusBadge = ({ j }: { j: Job }) => {
    const assignee = who(j);
    if (assignee)
      return (
        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          <HardHat className="mr-1 inline size-3" />
          {assignee}
        </span>
      );
    if (j.status === "completed" || j.status === "cancelled") return null;
    if (j.open_for_claim) {
      const n = claims.get(j.id) ?? 0;
      return n > 0 ? (
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {n} want{n === 1 ? "s" : ""} this
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
          On job board
        </span>
      );
    }
    return (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Not posted
      </span>
    );
  };

  const countLabel = queue.capped
    ? `${resultCountLabel(jobs.length, queue.total, "job")} — more matches exist. Add more of the name or address.`
    : resultCountLabel(jobs.length, queue.total, "job");

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={
          isCrew
            ? "Your assigned jobs."
            : mine
              ? "Sold work on your customers."
              : "Sold work, from material through install."
        }
      >
        {isStaff ? (
          <Link href="/jobs/new" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> New job
          </Link>
        ) : null}
      </PageHeader>

      {!isCrew ? (
        <div className="mb-4 inline-flex rounded-lg border p-0.5">
          {[
            { key: "mine" as const, label: "My jobs", n: mineCount },
            { key: "all" as const, label: "All jobs", n: allCount },
          ].map((t) => {
            const active = (t.key === "mine") === mine;
            return (
              <Link
                key={t.key}
                href={jobHref({ who: t.key, page: 1 })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "ml-1.5 tabular-nums",
                    active ? "text-primary-foreground/80" : "text-muted-foreground/70",
                  )}
                >
                  {t.n}
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}

      <WorkQueueBar
        action="/jobs"
        query={q}
        placeholder="Search customer, job, or address"
        hidden={[
          ...(view !== defaultView ? [{ name: "view", value: view }] : []),
          ...(!isCrew && mine ? [{ name: "who", value: "mine" }] : []),
          ...(!isCrew && !mine && profile.role === "salesman" ? [{ name: "who", value: "all" }] : []),
        ]}
        chips={QUEUE_CHIPS.map((chip) => ({
          href: jobHref({ view: chip.view, page: 1 }),
          label: chip.label,
          active: view === chip.view,
        }))}
        countLabel={countLabel}
      />

      {jobs.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={jobQueueEmpty(view, !!q)}
          description={
            mine && !isCrew
              ? "All jobs is one click away if this view is only your customers."
              : undefined
          }
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((j) => {
            const fact = jobQueueFact({
              status: j.status,
              scheduledDate: j.scheduled_date,
              todayYmd,
              hasMaterialNeed: queue.materialNeeds.get(j.id) ?? true,
              warehouseReadyAt: j.warehouse_ready_at,
              hasOpenServiceCallback: queue.serviceJobIds.has(j.id),
              openBalance: null,
            });
            return (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="block min-h-11 rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40 active:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">
                      {jobHeading(j, j.customer_name)}
                    </div>
                    {jobIdentityLine(j, j.customer_name) ? (
                      <div className="truncate text-sm font-medium text-violet-700 dark:text-violet-300">
                        {jobIdentityLine(j, j.customer_name)}
                      </div>
                    ) : null}
                  </div>
                  <StatusBadge j={j} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {j.scheduled_date ? formatDate(j.scheduled_date) : "Not scheduled"}
                  </span>
                  {j.customer_phone ? (
                    <span className="inline-flex items-center gap-1 font-medium text-foreground">
                      <Phone className="size-3" /> {j.customer_phone}
                    </span>
                  ) : null}
                  {j.arrival_window ? <span>{j.arrival_window}</span> : null}
                  {j.site_city ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" /> {j.site_city}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-xs font-medium text-muted-foreground">{fact}</p>
              </Link>
            );
          })}
        </div>
      )}

      <WorkQueuePager page={queue.page} pages={pages} hrefFor={(page) => jobHref({ page })} />
    </div>
  );
}

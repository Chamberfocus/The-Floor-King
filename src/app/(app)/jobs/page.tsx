import type { Metadata } from "next";
import { jobHeading, jobIdentityLine } from "@/lib/job-label";
import Link from "next/link";
import { Plus, MapPin, HardHat, ArrowRight, Phone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { listJobs, listAssignableUsers, claimRequestCounts } from "@/lib/data/jobs";
import { requireProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Job, WarehouseStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

type Lane = "schedule" | "prep" | "ready" | "installing" | "done";

const STAGED_STATUSES: WarehouseStatus[] = ["staged", "out_for_delivery", "delivered", "picked_up"];

/** Where a job sits in its lifecycle — combines job status + warehouse status. */
function laneOf(j: Job): Lane {
  if (j.status === "completed" || j.status === "cancelled") return "done";
  if (j.status === "in_progress") return "installing";
  if (STAGED_STATUSES.includes(j.warehouse_status)) return "ready";
  if (!j.scheduled_date) return "schedule";
  return "prep";
}

const LANES: { key: Lane; title: string; hint: string; accent: string; next: (j: Job) => string }[] = [
  { key: "schedule", title: "Needs scheduling", hint: "No install date yet", accent: "border-amber-400", next: () => "Schedule the install" },
  { key: "prep", title: "In prep", hint: "Warehouse pulling & staging", accent: "border-blue-400", next: (j) => (j.warehouse_submitted_at ? "Warehouse staging" : "Send to warehouse") },
  { key: "ready", title: "Ready to install", hint: "Staged — good to go", accent: "border-emerald-400", next: (j) => (j.scheduled_date ? `Install ${formatDate(j.scheduled_date)}` : "Schedule the install") },
  { key: "installing", title: "Installing", hint: "On site now", accent: "border-violet-400", next: () => "Finish & collect sign-off" },
  { key: "done", title: "Done", hint: "Completed / cancelled", accent: "border-muted", next: (j) => (j.status === "cancelled" ? "Cancelled" : "Completed") },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string }>;
}) {
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";
  const isCrew = profile.role === "crew";
  const mine = (await searchParams).who === "mine";

  // Installers see ONLY their own jobs here (the open board is its own page).
  // Scoped at the query level — not just RLS — so another installer's jobs are
  // never sent to the client. Everyone else gets the full list, or just theirs
  // when they've asked for it.
  const jobs = await listJobs(
    isCrew
      ? { assignedTo: profile.id }
      : mine
        ? { mineFor: profile.id }
        : {},
  );
  // Both counts, always — the tab has to show what you'd get before you click,
  // and "All (22)" next to "Mine (20)" is the whole point of the toggle.
  const mineCount = isCrew
    ? jobs.length
    : (await listJobs({ mineFor: profile.id })).length;
  const allCount = isCrew ? jobs.length : (await listJobs()).length;
  const users = isStaff ? await listAssignableUsers() : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const claims = isStaff ? await claimRequestCounts() : new Map<string, number>();

  const byLane = new Map<Lane, Job[]>();
  for (const j of jobs) {
    const lane = laneOf(j);
    (byLane.get(lane) ?? byLane.set(lane, []).get(lane)!).push(j);
  }

  const who = (j: Job) =>
    j.assigned_to ? (nameById.get(j.assigned_to) ?? "Assigned") : j.assigned_crew_id ? "Crew" : null;
  const site = (j: Job) => [j.site_city, j.site_state].filter(Boolean).join(", ");

  // The three states, at a glance: assigned · on the board (with claim requests)
  // · not posted (visible to no installer).
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
          🙋 {n} want{n === 1 ? "s" : ""} this
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

  const Card = ({
    j,
    next,
  }: {
    j: Job & { customer_name?: string | null; customer_phone?: string | null };
    next: string;
  }) => (
    <Link
      href={`/jobs/${j.id}`}
      className="block rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40 active:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        {/* The customer leads. The line under it is what tells two jobs on the
            same account apart — which address, and what the work is when the
            title says something the address doesn't. */}
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
        {/* The number on the row, so you can see who to ring without opening
            the job.

            Deliberately NOT a tel: link: this whole card is a <Link>, so an
            anchor inside it is a nested anchor, and stopping the click needed an
            onClick — which a Server Component cannot pass to a DOM element. That
            combination is what threw "An error occurred in the Server Components
            render" on this page. Tap-to-call lives on the work order, where it
            isn't inside a link. */}
        {j.customer_phone ? (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <Phone className="size-3" /> {j.customer_phone}
          </span>
        ) : null}
        {j.arrival_window ? <span>{j.arrival_window}</span> : null}
        {/* The street already leads the card; only the city adds anything. */}
        {j.site_city ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" /> {j.site_city}
          </span>
        ) : null}
      </div>
      <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
        {next} <ArrowRight className="size-3" />
      </div>
    </Link>
  );

  const activeLanes = LANES.filter((l) => l.key !== "done");
  const doneJobs = byLane.get("done") ?? [];

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={
          isCrew
            ? "Your assigned jobs."
            : mine
              ? "Sold work on your customers, from scheduling through to done. Client status covers everything before this."
              : "Sold work, from scheduling through to done. Client status covers everything before this."
        }
      >
        <div className="flex gap-2">
          {/* Scheduling lives in one place — the Install Scheduler (in the nav for
              scheduling roles). No separate read-only calendar to hunt for. */}
          {/* One button. "Quick install" sat beside this one doing the same
              thing with a different form; everything it could do — adding the
              customer on the spot, booking the date — moved onto /jobs/new. */}
          {isStaff ? (
            <Link href="/jobs/new" className={buttonVariants({ size: "lg" })}>
              <Plus className="size-4" /> New job
            </Link>
          ) : null}
        </div>
      </PageHeader>

      {/* Mine / All. A view, not a second login: switching identity would mean
          signing out to see everything, and would split your history across two
          accounts. "Mine" is the customer's salesperson or the current step's
          owner — NOT jobs.assigned_to, which is the installer. */}
      {!isCrew ? (
        <div className="mb-4 inline-flex rounded-lg border p-0.5">
          {[
            { key: "mine", label: "My jobs", n: mineCount, href: "/jobs?who=mine" },
            { key: "all", label: "All jobs", n: allCount, href: "/jobs" },
          ].map((t) => {
            const active = (t.key === "mine") === mine;
            return (
              <Link
                key={t.key}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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

      {jobs.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={
            mine
              ? "No jobs on your customers"
              : isStaff
                ? "No jobs yet"
                : "No jobs assigned to you yet"
          }
          description={
            mine
              ? `Nothing is assigned to you right now. There ${allCount === 1 ? "is" : "are"} ${allCount} job${allCount === 1 ? "" : "s"} in total — switch to All jobs to see everything.`
              : isStaff
                ? "Approve an estimate and create a job to get started."
                : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {activeLanes.map((lane) => {
            const items = byLane.get(lane.key) ?? [];
            if (!items.length) return null;
            return (
              <section key={lane.key}>
                <div className={cn("mb-2 flex items-baseline gap-2 border-l-4 pl-2", lane.accent)}>
                  <h2 className="text-lg font-bold">{lane.title}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{items.length}</span>
                  <span className="text-xs text-muted-foreground">{lane.hint}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((j) => (
                    <Card key={j.id} j={j} next={lane.next(j)} />
                  ))}
                </div>
              </section>
            );
          })}

          {doneJobs.length ? (
            <details className="rounded-xl border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted-foreground">
                Done ({doneJobs.length})
              </summary>
              <div className="grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
                {doneJobs.map((j) => (
                  <Card key={j.id} j={j} next={j.status === "cancelled" ? "Cancelled" : "Completed"} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

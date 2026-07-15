import type { Metadata } from "next";
import Link from "next/link";
import { Plus, MapPin, HardHat, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
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

export default async function JobsPage() {
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";
  const isCrew = profile.role === "crew";

  // Installers see ONLY their own jobs here (the open board is its own page).
  // Scoped at the query level — not just RLS — so another installer's jobs are
  // never sent to the client. Everyone else gets the full list.
  const jobs = await listJobs(isCrew ? { assignedTo: profile.id } : {});
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

  const Card = ({ j, next }: { j: Job & { customer_name?: string | null }; next: string }) => (
    <Link
      href={`/jobs/${j.id}`}
      className="block rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40 active:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{j.title || "Job"}</div>
          <div className="truncate text-sm text-muted-foreground">{j.customer_name ?? "—"}</div>
        </div>
        <StatusBadge j={j} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {j.scheduled_date ? formatDate(j.scheduled_date) : "Not scheduled"}
        </span>
        {j.arrival_window ? <span>{j.arrival_window}</span> : null}
        {site(j) ? (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3" /> {site(j)}
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
        description={isStaff ? "Every job by where it is in its lifecycle." : "Your assigned jobs."}
      >
        <div className="flex gap-2">
          {/* Scheduling lives in one place — the Install Scheduler (in the nav for
              scheduling roles). No separate read-only calendar to hunt for. */}
          {isStaff ? (
            <Link href="/jobs/quick" className={buttonVariants({ size: "lg" })}>
              <Plus className="size-4" /> Quick install
            </Link>
          ) : null}
        </div>
      </PageHeader>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {isStaff
            ? "No jobs yet. Approve an estimate and create a job to get started."
            : "No jobs assigned to you yet."}
        </div>
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

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { listCustomers, getProfileNames } from "@/lib/data/customers";
import { listOpenJobsForPipeline } from "@/lib/data/jobs";
import { workUnitsFor, type WorkUnit } from "@/lib/work-stage";
import { listWorkflowStages } from "@/lib/data/workflow";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Client status" };
export const dynamic = "force-dynamic";

/**
 * Where every client stands, in the lane layout the jobs page uses.
 *
 * This replaces Pipeline, which listed the same customers under thirteen
 * separate stage headings — accurate, and a wall. The jobs page reads better
 * because it groups a long lifecycle into a handful of lanes that each say what
 * happens next, so this borrows that shape.
 *
 * It is neither purely customers nor purely jobs. 17 of 46 live accounts have
 * no job at all — everyone with an estimate booked or a quote out — so a
 * jobs-only board hides the whole front half of the process. But a
 * customers-only board hid the back half of a repeat account: a contractor with
 * three jobs running showed once, in the lane of whichever job happened to own
 * the account's stage.
 *
 * So it lists WORK: one card per live job, or one for the account itself while
 * it has no job. src/lib/work-stage.ts is the rule; this just renders it.
 */

type LaneKey = "new" | "quoting" | "out" | "won" | "onsite" | "paying";

const LANES: {
  key: LaneKey;
  title: string;
  hint: string;
  accent: string;
  /** What you do next for anyone sitting here. */
  next: string;
}[] = [
  { key: "new", title: "New", hint: "Nothing booked yet", accent: "border-slate-400", next: "Call and book the measure" },
  { key: "quoting", title: "To quote", hint: "Measure booked or in hand", accent: "border-amber-400", next: "Build and send the estimate" },
  { key: "out", title: "Quote out", hint: "Waiting on the customer", accent: "border-blue-400", next: "Follow it up" },
  { key: "won", title: "Won — getting ready", hint: "Deposit, materials, scheduling", accent: "border-violet-400", next: "Order material and book the install" },
  { key: "onsite", title: "On site", hint: "Installing now", accent: "border-emerald-400", next: "Finish and get sign-off" },
  { key: "paying", title: "Getting paid", hint: "Work done, money outstanding", accent: "border-rose-400", next: "Collect the balance" },
];

/**
 * The thirteen stages fold into six lanes by POSITION, so a renamed stage or a
 * new one inserted in the middle lands in the right lane without a code change.
 * Off-spine stages (Lost / Declined) are matched by name, as everywhere else.
 */
function laneFor(stageName: string, position: number): LaneKey | null {
  if (/lost|declin|dead/i.test(stageName)) return null;
  if (/closed/i.test(stageName)) return null;
  if (position < 30) return "new";
  if (position < 50) return "quoting";
  if (position < 65) return "out";
  if (position < 105) return "won";
  if (position < 110) return "onsite";
  return "paying";
}

/** Past due = the next step's due date has already gone by. Shared so the
 *  "?overdue=1" filter and the "Stuck" badge can never disagree. */
function isPastDue(u: { dueAt?: string | null }): boolean {
  return !!u.dueAt && new Date(u.dueAt).getTime() < Date.now();
}

export default async function ClientStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; overdue?: string }>;
}) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const mine = sp.who === "mine";
  /**
   * "?overdue=1" — the filter the daily email and the dashboard badge have been
   * asking for all along. Both linked to /pipeline?mine=1&overdue=1; /pipeline
   * redirects here and dropped the query string, so clicking "3 overdue" (or the
   * link in your morning email) landed you on the entire book with no filter and
   * no explanation. The page already worked out which rows were overdue — it
   * just had no way to show only those.
   */
  const overdueOnly = sp.overdue === "1";

  const stages = await listWorkflowStages();
  const stageById = new Map(stages.map((s) => [s.id, s] as const));
  const all = (await listCustomers()).filter((c) => !c.cancelled_at);

  /**
   * One card per piece of WORK, not per account.
   *
   * This listed customers, so a contractor with three jobs running appeared
   * once, in the lane of whichever job happened to own the account's stage —
   * the other two invisible. Every job now carries its own stage, so the board
   * shows each of them, and an account with no job yet still shows once for the
   * lead itself. See src/lib/work-stage.ts.
   */
  const jobs = await listOpenJobsForPipeline();
  const jobsByCustomer = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const arr = jobsByCustomer.get(j.customer_id) ?? [];
    arr.push(j);
    jobsByCustomer.set(j.customer_id, arr);
  }

  const units = all.flatMap((c) => workUnitsFor(c, jobsByCustomer.get(c.id) ?? []));
  const mineOnly = mine
    ? units.filter((u) => u.ownerId === profile.id)
    : units;
  const work = overdueOnly ? mineOnly.filter(isPastDue) : mineOnly;

  const ownerIds = [...new Set(work.map((u) => u.ownerId).filter(Boolean))] as string[];
  const owners = ownerIds.length ? await getProfileNames(ownerIds) : {};

  const byLane = new Map<LaneKey, typeof work>();
  let closed = 0;
  let unstaged = 0;
  for (const u of work) {
    const st = u.stageId ? stageById.get(u.stageId) : null;
    if (!st) {
      unstaged++;
      continue;
    }
    const lane = laneFor(st.name, st.position);
    if (!lane) {
      closed++;
      continue;
    }
    const arr = byLane.get(lane) ?? [];
    arr.push(u);
    byLane.set(lane, arr);
  }

  const Card = ({ u, next }: { u: WorkUnit; next: string }) => {
    const st = u.stageId ? stageById.get(u.stageId) : null;
    const owner = u.ownerId ? owners[u.ownerId] : null;
    const overdue = isPastDue(u);
    return (
      <Link
        // A job card opens the work order; a pre-job lead opens their file.
        href={u.kind === "job" ? `/jobs/${u.id}` : `/customers/${u.customerId}`}
        className="block rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40 active:bg-muted/40"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{u.customerName}</div>
            {/* The customer is the heading above; this says WHICH of their
                addresses, which is what tells one card from another when an
                account has several jobs running. */}
            {u.site || u.title ? (
              <div className="truncate text-sm font-medium text-violet-700 dark:text-violet-300">
                {u.site ?? u.title}
              </div>
            ) : null}
            {st ? (
              <div className="truncate text-sm text-muted-foreground">{st.name}</div>
            ) : null}
          </div>
          {overdue ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
              <AlertTriangle className="size-3" /> Stuck
            </span>
          ) : owner ? (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {owner}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {u.dueAt ? (
            <span className={cn(overdue && "font-medium text-destructive")}>
              Due {formatDate(u.dueAt)}
            </span>
          ) : null}
        </div>
        <div className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
          {next} <ArrowRight className="size-3" />
        </div>
      </Link>
    );
  };

  const live = LANES.reduce((n, l) => n + (byLane.get(l.key)?.length ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Client status"
        description={
          overdueOnly
            ? "Only clients whose next step is past due."
            : "Every live client by where they stand — the whole book on one screen, newest work first."
        }
      >
        <Link href="/customers/new" className={buttonVariants({ size: "lg" })}>
          <Plus className="size-4" /> New customer
        </Link>
      </PageHeader>

      {/* Arriving from the overdue badge or the morning email: say so, and give
          a way back to the full book rather than leaving the filter invisible. */}
      {overdueOnly ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
          <span className="font-medium text-destructive">
            Showing past-due only
          </span>
          <Link
            href={mine ? "/client-status?who=mine" : "/client-status"}
            className="ml-auto text-xs font-medium text-primary hover:underline"
          >
            Show everything →
          </Link>
        </div>
      ) : null}

      <div className="mb-4 inline-flex rounded-lg border p-0.5">
        {[
          {
            key: "mine",
            label: "Mine",
            href: `/client-status?who=mine${overdueOnly ? "&overdue=1" : ""}`,
          },
          {
            key: "all",
            label: "Everyone",
            href: overdueOnly ? "/client-status?overdue=1" : "/client-status",
          },
        ].map((t) => {
          const active = (t.key === "mine") === mine;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {live === 0 ? (
        <EmptyState
          title="Nothing live"
          description={
            overdueOnly
              ? "Nothing is past due — you're caught up."
              : mine
                ? "Nothing assigned to you right now."
                : "Add a customer to get started."
          }
        />
      ) : (
        <div className="space-y-6">
          {LANES.map((lane) => {
            const items = byLane.get(lane.key) ?? [];
            if (!items.length) return null;
            return (
              <section key={lane.key}>
                <div className={cn("mb-2 flex items-baseline gap-2 border-l-4 pl-2", lane.accent)}>
                  <h2 className="text-lg font-bold">{lane.title}</h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                    {items.length}
                  </span>
                  <span className="text-xs text-muted-foreground">{lane.hint}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((u) => (
                    <Card key={`${u.kind}-${u.id}`} u={u} next={lane.next} />
                  ))}
                </div>
              </section>
            );
          })}

          {/* Finished and unfiled, out of the way but not hidden — a client with
              no stage is invisible everywhere else, which is how they get lost. */}
          {closed || unstaged ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {closed ? `${closed} closed or declined` : null}
              {closed && unstaged ? " · " : null}
              {unstaged ? (
                <Link href="/customers" className="underline">
                  {unstaged} with no stage set
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

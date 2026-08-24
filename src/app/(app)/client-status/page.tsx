import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MapPin, AlertTriangle, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { listCustomers, getProfileNames } from "@/lib/data/customers";
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
 * It has to be CUSTOMERS, not jobs. 17 of 41 live customers have no job at all
 * — everyone with an estimate booked or a quote out — and a jobs-only board
 * makes the entire front half of the process invisible.
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
function isPastDue(c: { next_action_due?: string | null }): boolean {
  return !!c.next_action_due && new Date(c.next_action_due).getTime() < Date.now();
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
  const mineOnly = mine
    ? all.filter((c) => c.assigned_to === profile.id || c.workflow_owner_id === profile.id)
    : all;
  const customers = overdueOnly ? mineOnly.filter(isPastDue) : mineOnly;

  const ownerIds = [
    ...new Set(customers.map((c) => c.workflow_owner_id ?? c.assigned_to).filter(Boolean)),
  ] as string[];
  const owners = ownerIds.length ? await getProfileNames(ownerIds) : {};

  const byLane = new Map<LaneKey, typeof customers>();
  let closed = 0;
  let unstaged = 0;
  for (const c of customers) {
    const st = c.workflow_stage_id ? stageById.get(c.workflow_stage_id) : null;
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
    arr.push(c);
    byLane.set(lane, arr);
  }

  const Card = ({ c, next }: { c: (typeof customers)[number]; next: string }) => {
    const st = c.workflow_stage_id ? stageById.get(c.workflow_stage_id) : null;
    const owner = owners[(c.workflow_owner_id ?? c.assigned_to) as string];
    const overdue = isPastDue(c);
    return (
      <Link
        href={`/customers/${c.id}`}
        className="block rounded-xl border bg-card p-3.5 transition-colors hover:border-primary/40 active:bg-muted/40"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{c.full_name}</div>
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
          {c.city ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" /> {[c.city, c.state].filter(Boolean).join(", ")}
            </span>
          ) : null}
          {c.next_action_due ? (
            <span className={cn(overdue && "font-medium text-destructive")}>
              Due {formatDate(c.next_action_due)}
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
                  {items.map((c) => (
                    <Card key={c.id} c={c} next={lane.next} />
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

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ChevronsUpDown, AlertTriangle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StageBadge } from "@/components/stage-badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { ArrivalWindow } from "@/lib/format";
import {
  LEAD_SOURCE_LABELS,
  DUTY_ROLES,
  DUTY_LABELS,
  STAGE_COLOR_BADGE,
  inferStageDuty,
  type Customer,
} from "@/lib/types";
import type { QuickAction } from "@/lib/preferences";
import type { CustomerRowContext } from "@/lib/data/customers";
import { QuickActions } from "./[id]/quick-actions";

/** Shared data fetched once by the page, reused by every row. */
export interface ListShared {
  stages: {
    id: string;
    name: string;
    color: string;
    position: number;
    auto_action: string | null;
    owner_duty: string | null;
  }[];
  members: { id: string; name: string; title: string | null; role: string }[];
  reps: { id: string; name: string }[];
  installOptions: { id: string; name: string }[];
  arrivalWindows: ArrivalWindow[];
  listActions: QuickAction[];
  /** URL to return to after a row action, so we stay on the (filtered) list. */
  listHref: string;
}

/** Map a customer + its context + shared data into QuickActions props (role-
 *  scoped assignee list, resolved owner/installer/rep names). */
function quickProps(
  c: Customer,
  ctx: CustomerRowContext | undefined,
  shared: ListShared,
) {
  const stage = shared.stages.find((s) => s.id === c.workflow_stage_id) ?? null;
  const duty = inferStageDuty(stage) ?? stage?.owner_duty ?? null;
  const roles = duty ? DUTY_ROLES[duty] : null;
  const nameById = (id: string | null) =>
    id ? (shared.members.find((m) => m.id === id)?.name ?? null) : null;
  const reassignOptions = (
    roles
      ? shared.members.filter(
          (m) =>
            (roles as string[]).includes(m.role) ||
            m.id === c.workflow_owner_id,
        )
      : shared.members
  ).map((m) => ({ id: m.id, name: m.name, title: m.title }));

  return {
    customerId: c.id,
    stages: shared.stages.map((s) => ({ id: s.id, name: s.name })),
    currentStageId: c.workflow_stage_id ?? null,
    currentStageName: stage?.name ?? null,
    currentOwnerId: c.workflow_owner_id ?? null,
    assignedRepId: c.assigned_to ?? null,
    currentOwnerName: nameById(c.workflow_owner_id ?? null),
    ownerDutyLabel: duty ? DUTY_LABELS[duty] : null,
    reassignOptions,
    repOptions: shared.reps,
    installOptions: shared.installOptions,
    estimate: ctx?.estimate
      ? {
          startsAt: ctx.estimate.startsAt,
          rep: nameById(ctx.estimate.salespersonId),
        }
      : null,
    job: ctx?.job
      ? { ...ctx.job, installerName: nameById(ctx.job.installerId) }
      : null,
    arrivalWindows: shared.arrivalWindows,
    actions: shared.listActions,
    showSwitcher: false,
    compact: true,
    redirectTo: shared.listHref,
  };
}

function ExpandToggle({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? "Hide quick actions" : "Show quick actions"}
      className="inline-flex items-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ChevronDown
        className={cn("size-4 transition-transform", open && "rotate-180")}
      />
    </button>
  );
}

/** The salesperson a client is permanently assigned to (admin-only column). */
function assignedName(c: Customer, shared: ListShared): string {
  if (!c.assigned_to) return "Unassigned";
  return (
    shared.members.find((m) => m.id === c.assigned_to)?.name ?? "Unassigned"
  );
}

/** The customer's ACTUAL detailed workflow stage (the 13-stage builder),
 *  colored by that stage's own color. Falls back to the lead-stage bucket only
 *  if the customer somehow has no workflow stage. */
function DetailedStageBadge({ c, shared }: { c: Customer; shared: ListShared }) {
  const wf = shared.stages.find((s) => s.id === c.workflow_stage_id);
  if (!wf) return <StageBadge stage={c.stage} />;
  const cls = STAGE_COLOR_BADGE[wf.color] ?? STAGE_COLOR_BADGE.zinc;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      {wf.name}
    </span>
  );
}

/** Flag for a client sitting past its stage's time limit. */
function StuckBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
      <AlertTriangle className="size-3.5" /> Stuck
    </span>
  );
}

function DesktopRow({
  c,
  ctx,
  shared,
  isAdmin,
  overdue,
}: {
  c: Customer;
  ctx: CustomerRowContext | undefined;
  shared: ListShared;
  isAdmin: boolean;
  overdue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasActions = shared.listActions.length > 0;
  return (
    <>
      <TableRow>
        {/* First column, so the expander is always in view — it used to sit in
            the last of eight columns and needed a horizontal scroll to reach. */}
        <TableCell className="w-9 pr-0 align-top">
          {hasActions ? (
            <ExpandToggle open={open} onClick={() => setOpen((v) => !v)} />
          ) : null}
        </TableCell>
        <TableCell className="font-medium">
          <Link href={`/customers/${c.id}`} className="hover:underline">
            {c.full_name}
          </Link>
          {c.company ? (
            <span className="block text-xs text-muted-foreground">
              {c.company}
            </span>
          ) : null}
        </TableCell>
        {isAdmin ? (
          <TableCell
            className={
              c.assigned_to ? "font-medium" : "text-muted-foreground italic"
            }
          >
            {assignedName(c, shared)}
          </TableCell>
        ) : null}
        <TableCell>
          <div className="flex flex-wrap items-center gap-1.5">
            <DetailedStageBadge c={c} shared={shared} />
            {overdue ? <StuckBadge /> : null}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
        <TableCell className="text-muted-foreground">{c.city ?? "—"}</TableCell>
        <TableCell className="text-muted-foreground">
          {c.source ? LEAD_SOURCE_LABELS[c.source] : "—"}
        </TableCell>
        <TableCell className="text-right text-muted-foreground">
          {formatDate(c.updated_at)}
        </TableCell>
      </TableRow>
      {open && hasActions ? (
        <TableRow>
          <TableCell colSpan={isAdmin ? 8 : 7} className="bg-muted/30">
            <QuickActions {...quickProps(c, ctx, shared)} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function MobileCard({
  c,
  ctx,
  shared,
  isAdmin,
  overdue,
}: {
  c: Customer;
  ctx: CustomerRowContext | undefined;
  shared: ListShared;
  isAdmin: boolean;
  overdue: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasActions = shared.listActions.length > 0;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/customers/${c.id}`} className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.full_name}</div>
          {c.company ? (
            <div className="truncate text-xs text-muted-foreground">
              {c.company}
            </div>
          ) : null}
          {isAdmin ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Assigned to{" "}
              <span
                className={
                  c.assigned_to ? "font-medium text-foreground" : "italic"
                }
              >
                {assignedName(c, shared)}
              </span>
            </div>
          ) : null}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {overdue ? <StuckBadge /> : null}
          <DetailedStageBadge c={c} shared={shared} />
          {hasActions ? (
            <ExpandToggle open={open} onClick={() => setOpen((v) => !v)} />
          ) : null}
        </div>
      </div>
      <Link
        href={`/customers/${c.id}`}
        className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
      >
        {c.phone ? <span>{c.phone}</span> : null}
        {c.city ? <span>{c.city}</span> : null}
        {c.source ? <span>{LEAD_SOURCE_LABELS[c.source]}</span> : null}
        <span className="ml-auto">{formatDate(c.updated_at)}</span>
      </Link>
      {open && hasActions ? (
        <div className="mt-3 border-t pt-3">
          <QuickActions {...quickProps(c, ctx, shared)} />
        </div>
      ) : null}
    </div>
  );
}

type SortKey = "name" | "assigned" | "stage" | "phone" | "city" | "source" | "updated";

/** A clickable, sort-toggling column header. */
function SortTh({
  label,
  k,
  sortKey,
  dir,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sortKey === k;
  return (
    <TableHead
      className={align === "right" ? "text-right" : undefined}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />
        ) : (
          <ChevronsUpDown className="size-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export function CustomerList({
  customers,
  contexts,
  shared,
  isAdmin = false,
}: {
  customers: Customer[];
  contexts: Record<string, CustomerRowContext>;
  shared: ListShared;
  /** Show the "Assigned to" (salesperson) column — admin only. */
  isAdmin?: boolean;
}) {
  const nowMs = Date.now();
  const isOverdue = (c: Customer) =>
    !!c.next_action_due && new Date(c.next_action_due).getTime() < nowMs;

  // Click a column to sort by it (toggles asc/desc). Stage sorts by the pipeline
  // ORDER (stage position), not alphabetically — New Lead → … → Closed.
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const sortBy = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(k === "updated" ? "desc" : "asc");
    }
  };

  const stagePos = (c: Customer): number => {
    const s = shared.stages.find((x) => x.id === c.workflow_stage_id);
    // Unstaged rows sort to the end regardless of direction.
    return s ? s.position : Number.MAX_SAFE_INTEGER;
  };
  const sortVal = (c: Customer): string | number => {
    switch (sortKey) {
      case "name": return (c.full_name ?? "").toLowerCase();
      case "assigned": return assignedName(c, shared).toLowerCase();
      case "stage": return stagePos(c);
      case "phone": return (c.phone ?? "").toLowerCase();
      case "city": return (c.city ?? "").toLowerCase();
      case "source": return (c.source ? LEAD_SOURCE_LABELS[c.source] : "").toLowerCase();
      case "updated": return new Date(c.updated_at).getTime();
    }
  };
  const sorted = useMemo(() => {
    const arr = [...customers];
    arr.sort((a, b) => {
      const av = sortVal(a);
      const bv = sortVal(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers, sortKey, dir]);

  const SORT_LABELS: { k: SortKey; label: string }[] = [
    { k: "name", label: "Name" },
    ...(isAdmin ? [{ k: "assigned" as SortKey, label: "Assigned to" }] : []),
    { k: "stage", label: "Stage" },
    { k: "city", label: "City" },
    { k: "source", label: "Source" },
    { k: "updated", label: "Updated" },
  ];

  return (
    <>
      {/* Phone: a sort control, then tappable cards */}
      <div className="mb-2 flex items-center gap-2 md:hidden">
        <span className="text-xs text-muted-foreground">Sort by</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {SORT_LABELS.map((s) => (
            <option key={s.k} value={s.k}>{s.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
          aria-label="Toggle sort direction"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-input px-2 text-sm"
        >
          {dir === "asc" ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {dir === "asc" ? "A–Z" : "Z–A"}
        </button>
      </div>
      <div className="space-y-2 md:hidden">
        {sorted.map((c) => (
          <MobileCard
            key={c.id}
            c={c}
            ctx={contexts[c.id]}
            shared={shared}
            isAdmin={isAdmin}
            overdue={isOverdue(c)}
          />
        ))}
      </div>
      {/* Larger screens: table, each row expandable to quick actions */}
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9" aria-label="Quick actions" />
              <SortTh label="Name" k="name" sortKey={sortKey} dir={dir} onSort={sortBy} />
              {isAdmin ? (
                <SortTh label="Assigned to" k="assigned" sortKey={sortKey} dir={dir} onSort={sortBy} />
              ) : null}
              <SortTh label="Stage" k="stage" sortKey={sortKey} dir={dir} onSort={sortBy} />
              <SortTh label="Phone" k="phone" sortKey={sortKey} dir={dir} onSort={sortBy} />
              <SortTh label="City" k="city" sortKey={sortKey} dir={dir} onSort={sortBy} />
              <SortTh label="Source" k="source" sortKey={sortKey} dir={dir} onSort={sortBy} />
              <SortTh label="Updated" k="updated" sortKey={sortKey} dir={dir} onSort={sortBy} align="right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((c) => (
              <DesktopRow
                key={c.id}
                c={c}
                ctx={contexts[c.id]}
                shared={shared}
                isAdmin={isAdmin}
                overdue={isOverdue(c)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

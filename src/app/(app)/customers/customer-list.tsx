"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, AlertTriangle } from "lucide-react";
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
            <StageBadge stage={c.stage} />
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
        <TableCell className="text-right">
          {hasActions ? (
            <ExpandToggle open={open} onClick={() => setOpen((v) => !v)} />
          ) : null}
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
          <StageBadge stage={c.stage} />
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
  return (
    <>
      {/* Phone: tappable cards, each expandable to quick actions */}
      <div className="space-y-2 md:hidden">
        {customers.map((c) => (
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
              <TableHead>Name</TableHead>
              {isAdmin ? <TableHead>Assigned to</TableHead> : null}
              <TableHead>Stage</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead className="w-10 text-right" aria-label="Quick actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => (
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

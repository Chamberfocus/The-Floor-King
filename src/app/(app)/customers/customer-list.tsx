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
import { cn } from "@/lib/utils";
import type {
  CustomerListQuickModel,
  CustomerListRowModel,
  CustomerListSortKey,
} from "@/lib/customers-list-view";
import { QuickActions } from "./[id]/quick-actions";

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

function ActivitySummary({ row }: { row: CustomerListRowModel }) {
  if (!row.activityLine && !row.moneyLine) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
      {row.activityLine ? (
        <div className="font-medium text-foreground/80">{row.activityLine}</div>
      ) : null}
      {row.moneyLine ? <div>{row.moneyLine}</div> : null}
    </div>
  );
}

function StageLabel({ row }: { row: CustomerListRowModel }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        row.stageClassName,
      )}
    >
      {row.stageLabel}
    </span>
  );
}

function StuckBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
      <AlertTriangle className="size-3.5" /> Stuck
    </span>
  );
}

function RowActions({
  open,
  quick,
}: {
  open: boolean;
  quick: CustomerListQuickModel | null;
}) {
  if (!open || !quick) return null;
  return <QuickActions {...quick} />;
}

function DesktopRow({
  row,
  isAdmin,
}: {
  row: CustomerListRowModel;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow>
        <TableCell className="w-9 pr-0 align-top">
          {row.hasActions ? (
            <ExpandToggle open={open} onClick={() => setOpen((v) => !v)} />
          ) : null}
        </TableCell>
        <TableCell className="font-medium">
          <Link href={`/customers/${row.id}`} className="hover:underline">
            {row.displayName}
          </Link>
          {row.company ? (
            <span className="block text-xs text-muted-foreground">{row.company}</span>
          ) : null}
          {row.contactLine ? (
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {row.contactLine}
            </span>
          ) : null}
          <ActivitySummary row={row} />
        </TableCell>
        {isAdmin ? (
          <TableCell className={row.hasAssignee ? "font-medium" : "text-muted-foreground italic"}>
            {row.assignedLabel}
          </TableCell>
        ) : null}
        <TableCell>
          <div className="flex flex-wrap items-center gap-1.5">
            <StageLabel row={row} />
            {row.overdue ? <StuckBadge /> : null}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{row.phone || "—"}</TableCell>
        <TableCell className="text-muted-foreground">{row.city || "—"}</TableCell>
        <TableCell className="text-muted-foreground">{row.sourceLabel || "—"}</TableCell>
        <TableCell className="text-right text-muted-foreground">
          {row.updatedDisplay}
        </TableCell>
      </TableRow>
      {open && row.hasActions ? (
        <TableRow>
          <TableCell colSpan={isAdmin ? 8 : 7} className="bg-muted/30">
            <RowActions open={open} quick={row.quick} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function MobileCard({
  row,
  isAdmin,
}: {
  row: CustomerListRowModel;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/customers/${row.id}`} className="min-w-0 flex-1">
          <div className="truncate font-medium">{row.displayName}</div>
          {row.company ? (
            <div className="truncate text-xs text-muted-foreground">{row.company}</div>
          ) : null}
          {row.contactLine ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.contactLine}</div>
          ) : null}
          <ActivitySummary row={row} />
          {isAdmin ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              Assigned to{" "}
              <span className={row.hasAssignee ? "font-medium text-foreground" : "italic"}>
                {row.assignedLabel}
              </span>
            </div>
          ) : null}
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {row.overdue ? <StuckBadge /> : null}
          <StageLabel row={row} />
          {row.hasActions ? (
            <ExpandToggle open={open} onClick={() => setOpen((v) => !v)} />
          ) : null}
        </div>
      </div>
      <Link
        href={`/customers/${row.id}`}
        className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
      >
        {row.phone ? <span>{row.phone}</span> : null}
        {row.city ? <span>{row.city}</span> : null}
        {row.sourceLabel ? <span>{row.sourceLabel}</span> : null}
        <span className="ml-auto">{row.updatedDisplay}</span>
      </Link>
      {open && row.hasActions ? (
        <div className="mt-3 border-t pt-3">
          <RowActions open={open} quick={row.quick} />
        </div>
      ) : null}
    </div>
  );
}

function SortTh({
  label,
  k,
  sortKey,
  dir,
  onSort,
  align,
}: {
  label: string;
  k: CustomerListSortKey;
  sortKey: CustomerListSortKey;
  dir: "asc" | "desc";
  onSort: (k: CustomerListSortKey) => void;
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
  rows,
  isAdmin = false,
}: {
  rows: CustomerListRowModel[];
  isAdmin?: boolean;
}) {
  const [sortKey, setSortKey] = useState<CustomerListSortKey>("updated");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const sortBy = (k: CustomerListSortKey) => {
    if (k === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setDir(k === "updated" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a.sort[sortKey];
      const bv = b.sort[sortKey];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, dir]);

  const SORT_LABELS: { k: CustomerListSortKey; label: string }[] = [
    { k: "name", label: "Name" },
    ...(isAdmin ? [{ k: "assigned" as const, label: "Assigned to" }] : []),
    { k: "stage", label: "Stage" },
    { k: "city", label: "City" },
    { k: "source", label: "Source" },
    { k: "updated", label: "Updated" },
  ];

  return (
    <>
      <div className="mb-2 flex items-center gap-2 md:hidden">
        <span className="text-xs text-muted-foreground">Sort by</span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as CustomerListSortKey)}
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
        {sorted.map((row) => (
          <MobileCard key={row.id} row={row} isAdmin={isAdmin} />
        ))}
      </div>
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
            {sorted.map((row) => (
              <DesktopRow key={row.id} row={row} isAdmin={isAdmin} />
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

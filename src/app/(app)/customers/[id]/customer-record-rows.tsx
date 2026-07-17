"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText, Wrench, Receipt, ExternalLink, Calendar, User } from "lucide-react";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { JobStatusBadge } from "@/components/job-status-badge";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { JobScopeView } from "@/components/job-scope-view";
import { DeleteEstimateButton } from "@/app/(app)/estimates/estimate-list-actions";
import { formatMoney, formatDate } from "@/lib/format";
import type { EstimateStatus, InvoiceStatus, JobStatus } from "@/lib/types";
import type { JobScope } from "@/lib/job-scope";

/** Shared expandable shell — a tappable header row that reveals an in-context
 *  panel below it (so you never leave the customer record), with a link out to
 *  the full page for editing. */
function ExpandRow({
  icon,
  title,
  right,
  actions,
  href,
  openLabel,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  right?: React.ReactNode;
  /** Interactive controls (e.g. delete) rendered OUTSIDE the toggle button —
   *  nesting a button inside the header button is invalid and would swallow the tap. */
  actions?: React.ReactNode;
  href: string;
  openLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left"
        >
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
          />
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {right ? <span className="flex shrink-0 items-center gap-2">{right}</span> : null}
        </button>
        {actions ? <div className="flex shrink-0 items-center pr-2">{actions}</div> : null}
      </div>
      {open ? (
        <div className="border-t p-3">
          {children}
          <div className="mt-3 flex justify-end">
            <Link
              href={href}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:border-primary hover:text-primary"
            >
              <ExternalLink className="size-3.5" /> {openLabel}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface EstimateRowData {
  id: string;
  title: string;
  status: EstimateStatus;
  total: number;
  optionName: string | null;
  lines: { id: string; label: string; amount: number }[];
}

export function EstimateRow({
  e,
  customerId,
  customerName,
}: {
  e: EstimateRowData;
  customerId: string;
  customerName?: string;
}) {
  return (
    <ExpandRow
      icon={<FileText className="size-4" />}
      title={e.title}
      href={`/estimates/${e.id}`}
      openLabel="Open full estimate"
      right={
        <>
          <EstimateStatusBadge status={e.status} />
          <span className="font-semibold tabular-nums">{formatMoney(e.total)}</span>
        </>
      }
      actions={
        <DeleteEstimateButton
          id={e.id}
          customerId={customerId}
          customerName={customerName}
        />
      }
    >
      {e.optionName ? (
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {e.optionName}
        </div>
      ) : null}
      {e.lines.length ? (
        <ul className="divide-y text-sm">
          {e.lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">{l.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatMoney(l.amount)}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 pt-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(e.total)}</span>
          </li>
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No line items on this estimate.</p>
      )}
    </ExpandRow>
  );
}

export interface WorkOrderRowData {
  id: string;
  title: string;
  status: JobStatus;
  scheduledDate: string | null;
  crewName: string | null;
  showPrices: boolean;
  scope: JobScope;
}

export function WorkOrderRow({ j }: { j: WorkOrderRowData }) {
  return (
    <ExpandRow
      icon={<Wrench className="size-4" />}
      title={j.title}
      href={`/jobs/${j.id}`}
      openLabel="Open full work order"
      right={
        <>
          <JobStatusBadge status={j.status} />
          {j.scheduledDate ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {formatDate(j.scheduledDate)}
            </span>
          ) : null}
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <Calendar className="size-3.5 text-muted-foreground" />
          {j.scheduledDate ? formatDate(j.scheduledDate) : "Not scheduled"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <User className="size-3.5 text-muted-foreground" />
          {j.crewName ?? "Unassigned"}
        </span>
      </div>
      <JobScopeView scope={j.scope} showPrices={j.showPrices} />
    </ExpandRow>
  );
}

export interface InvoiceRowData {
  id: string;
  number: string;
  status: InvoiceStatus;
  balance: number;
  total: number;
  paid: number;
  lines: { id: string; label: string; amount: number }[];
}

export function InvoiceRow({ inv }: { inv: InvoiceRowData }) {
  return (
    <ExpandRow
      icon={<Receipt className="size-4" />}
      title={inv.number}
      href={`/invoices/${inv.id}`}
      openLabel="Open full invoice"
      right={
        <>
          <InvoiceStatusBadge status={inv.status} />
          <span className="font-semibold tabular-nums">
            {formatMoney(inv.balance)} <span className="font-normal text-muted-foreground">due</span>
          </span>
        </>
      }
    >
      {inv.lines.length ? (
        <ul className="divide-y text-sm">
          {inv.lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">{l.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatMoney(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 space-y-1 border-t pt-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular-nums">{formatMoney(inv.total)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Paid</span>
          <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
            {formatMoney(inv.paid)}
          </span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Balance</span>
          <span className="tabular-nums">{formatMoney(inv.balance)}</span>
        </div>
      </div>
    </ExpandRow>
  );
}

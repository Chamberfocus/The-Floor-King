"use client";

import { useState } from "react";
import Link from "next/link";
import {
  FileText,
  Receipt,
  ShoppingCart,
  ClipboardList,
  Warehouse,
  CheckCircle2,
  Ruler,
  ChevronRight,
  Printer,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { useJobTab, type JobTab } from "./job-tabs";
import type {
  JobDocGroup,
  JobDocument,
  DocTone,
} from "@/lib/data/job-documents";

const ICONS: Record<JobDocument["type"], LucideIcon> = {
  estimate: FileText,
  invoice: Receipt,
  po: ShoppingCart,
  work_order: ClipboardList,
  staging: Warehouse,
  completion: CheckCircle2,
  measurement: Ruler,
};

const TONE: Record<DocTone, string> = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
};

function DocRow({ doc }: { doc: JobDocument }) {
  const { setActive } = useJobTab();
  const [open, setOpen] = useState(false);
  const Icon = ICONS[doc.type];

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium">{doc.title}</span>
            {doc.status ? (
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", TONE[doc.tone])}>
                {doc.status}
              </span>
            ) : null}
          </div>
          <div className="text-xs text-muted-foreground">
            {[
              doc.date ? formatDate(doc.date) : null,
              doc.createdBy ? `by ${doc.createdBy}` : null,
              doc.subtitle,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
        {doc.amount != null ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {formatMoney(doc.amount)}
          </span>
        ) : null}
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </button>

      {open ? (
        <div className="border-t bg-muted/30 px-3 py-3 text-sm">
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {doc.date ? <span>Created {formatDate(doc.date)}</span> : null}
            {doc.createdBy ? <span>By {doc.createdBy}</span> : null}
            {doc.status ? <span>Status: {doc.status}</span> : null}
            {doc.amount != null ? <span>Amount: {formatMoney(doc.amount)}</span> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {doc.href ? (
              <Link
                href={doc.href}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <ExternalLink className="size-3.5" /> Open full page
              </Link>
            ) : null}
            {doc.print === "work_order" ? (
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <Printer className="size-3.5" /> Print work order
              </button>
            ) : null}
            {doc.print === "staging" ? (
              <Link
                href="/warehouse"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <ExternalLink className="size-3.5" /> Open in Warehouse
              </Link>
            ) : null}
            {doc.fileUrl ? (
              <a
                href={doc.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <ExternalLink className="size-3.5" /> Open file
              </a>
            ) : null}
            {doc.tab && !doc.href ? (
              <button
                type="button"
                onClick={() => setActive(doc.tab as JobTab)}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                View detail →
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The job's whole document history — grouped by type so it's obvious what
 *  exists and what's missing. Each row opens in place, with an open-full-page
 *  option. Reads real records — never copies. */
export function JobDocuments({ groups }: { groups: JobDocGroup[] }) {
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </h3>
            <span className="text-xs text-muted-foreground">
              {g.items.length || "None yet"}
            </span>
          </div>
          {g.items.length ? (
            <div className="space-y-2">
              {g.items.map((d) => (
                <DocRow key={d.key} doc={d} />
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
              None yet.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Hammer, Boxes, Receipt, Printer, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DocJob {
  id: string;
  label: string;
  estimateId: string | null;
  invoiceId: string | null;
}

/**
 * One-click access to a customer's four printable documents for the chosen job.
 * Each tile links to the REAL record's print view (opens ready to print); a
 * document that doesn't exist yet is shown greyed with a short reason. The
 * customer firewall is untouched — these just open the existing docs.
 */
export function DocumentShortcuts({
  jobs,
  fallbackEstimateId,
  fallbackInvoiceId,
}: {
  jobs: DocJob[];
  /** Used when the customer has no job yet (estimate/invoice may still exist). */
  fallbackEstimateId: string | null;
  fallbackInvoiceId: string | null;
}) {
  const [sel, setSel] = useState(0);
  const hasJobs = jobs.length > 0;
  const job = hasJobs ? jobs[Math.min(sel, jobs.length - 1)] : null;

  const estimateId = job ? job.estimateId : fallbackEstimateId;
  const invoiceId = job ? job.invoiceId : fallbackInvoiceId;

  const tiles: {
    icon: LucideIcon;
    label: string;
    href: string | null;
    reason: string;
  }[] = [
    {
      icon: FileText,
      label: "Estimate",
      href: estimateId ? `/estimates/${estimateId}?print=1` : null,
      reason: "No estimate yet",
    },
    {
      icon: Hammer,
      label: "Work order",
      href: job ? `/jobs/${job.id}?print=work_order` : null,
      reason: "No job yet",
    },
    {
      icon: Boxes,
      label: "Staging sheet",
      href: job ? `/jobs/${job.id}/staging-sheet` : null,
      reason: "No job yet",
    },
    {
      icon: Receipt,
      label: "Invoice",
      href: invoiceId ? `/invoices/${invoiceId}?print=1` : null,
      reason: "No invoice yet",
    },
  ];

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Printer className="size-4 text-muted-foreground" /> Print documents
        </CardTitle>
        {jobs.length > 1 ? (
          <select
            value={sel}
            onChange={(e) => setSel(Number(e.target.value))}
            aria-label="Choose which job's documents"
            className="h-9 max-w-[14rem] rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {jobs.map((j, i) => (
              <option key={j.id} value={i}>
                {j.label}
              </option>
            ))}
          </select>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map((t) => {
            const Icon = t.icon;
            if (t.href) {
              return (
                <Link
                  key={t.label}
                  href={t.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center transition-colors hover:border-primary hover:bg-muted"
                >
                  <Icon className="size-6 text-primary" />
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="text-[11px] text-muted-foreground">Open &amp; print</span>
                </Link>
              );
            }
            return (
              <div
                key={t.label}
                className="flex cursor-not-allowed flex-col items-center gap-1.5 rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 text-center opacity-70"
                title={t.reason}
              >
                <Icon className="size-6 text-muted-foreground/50" />
                <span className="text-sm font-medium text-muted-foreground">{t.label}</span>
                <span className="text-[11px] text-muted-foreground">{t.reason}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

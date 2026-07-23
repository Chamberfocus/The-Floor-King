"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Hammer, Boxes, Receipt, Printer, Eye, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DocJob {
  id: string;
  label: string;
  estimateId: string | null;
  invoiceId: string | null;
}

/**
 * One-click access to a customer's four documents for the chosen job. Each tile
 * offers two actions on the REAL record: Preview (open the doc to read, no print
 * dialog) and Print (open ready to print / save as PDF). A document that doesn't
 * exist yet is shown greyed with a short reason. The customer firewall is
 * untouched — these just open the existing docs.
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
    /** Opens the doc ready to print / save as PDF (fires the print dialog). */
    printHref: string | null;
    /** Opens the same doc to just read — no print dialog. */
    previewHref: string | null;
    reason: string;
  }[] = [
    {
      icon: FileText,
      label: "Estimate",
      printHref: estimateId ? `/estimates/${estimateId}?print=1` : null,
      previewHref: estimateId ? `/estimates/${estimateId}` : null,
      reason: "No estimate yet",
    },
    {
      icon: Hammer,
      label: "Work order",
      printHref: job ? `/jobs/${job.id}?print=work_order` : null,
      previewHref: job ? `/jobs/${job.id}` : null,
      reason: "No job yet",
    },
    {
      icon: Boxes,
      label: "Staging sheet",
      // The staging sheet auto-prints by default; ?print=0 suppresses that so it
      // opens as a readable preview.
      printHref: job ? `/jobs/${job.id}/staging-sheet` : null,
      previewHref: job ? `/jobs/${job.id}/staging-sheet?print=0` : null,
      reason: "No job yet",
    },
    {
      icon: Receipt,
      label: "Invoice",
      printHref: invoiceId ? `/invoices/${invoiceId}?print=1` : null,
      previewHref: invoiceId ? `/invoices/${invoiceId}` : null,
      reason: "No invoice yet",
    },
  ];

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4 text-muted-foreground" /> Documents
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
            if (t.previewHref && t.printHref) {
              return (
                <div
                  key={t.label}
                  className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-3 text-center"
                >
                  <Icon className="size-6 text-primary" />
                  <span className="text-sm font-medium">{t.label}</span>
                  <div className="mt-1 grid w-full grid-cols-2 gap-1.5">
                    <Link
                      href={t.previewHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
                    >
                      <Eye className="size-3.5" /> Preview
                    </Link>
                    <Link
                      href={t.printHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Printer className="size-3.5" /> Print
                    </Link>
                  </div>
                </div>
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

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
      previewHref: estimateId ? `/estimates/${estimateId}?preview=1` : null,
      reason: "No estimate yet",
    },
    {
      icon: Hammer,
      label: "Work order",
      printHref: job ? `/jobs/${job.id}?print=work_order` : null,
      previewHref: job ? `/jobs/${job.id}?preview=1` : null,
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
      previewHref: invoiceId ? `/invoices/${invoiceId}?preview=1` : null,
      reason: "No invoice yet",
    },
  ];

  const ready = tiles.filter((t) => t.previewHref && t.printHref);
  if (!ready.length) return null;

  return (
    <Card className="mb-0 shadow-none">
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
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2">
          {ready.map((t) => {
            const Icon = t.icon;
            if (t.previewHref && t.printHref) {
              return (
                <div key={t.label} className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-2 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="font-medium">{t.label}</span>
                  <Link href={t.previewHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 px-1 hover:text-primary">
                    <Eye className="size-3.5" aria-hidden /> Preview
                  </Link>
                  <Link href={t.printHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 px-1 hover:text-primary">
                    <Printer className="size-3.5" aria-hidden /> Print
                  </Link>
                </div>
              );
            }
            return null;
          })}
          <a href="#files" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-primary hover:underline">
            View files
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

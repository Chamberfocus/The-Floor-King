import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getEstimate } from "@/lib/data/estimates";
import { getCurrentApprovalSnapshot } from "@/lib/data/estimate-approvals";
import { assessInvoiceCommercialGate } from "@/lib/estimate-approval";
import { snapshotLinesAsEstimateLines } from "@/lib/approval-snapshot-view";
import { InvoiceLinePicker } from "./invoice-line-picker";

export const metadata: Metadata = { title: "Build invoice" };

export default async function BuildInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimate(id);
  if (!estimate) notFound();

  const snap = await getCurrentApprovalSnapshot(id);
  const gate = assessInvoiceCommercialGate({
    status: estimate.status,
    approvalStale: Boolean(estimate.approval_stale),
    hasSnapshot: !!snap,
  });

  if (!gate.ok || !snap) {
    const message = gate.ok
      ? "This estimate does not have an approval snapshot on file. Review and reapprove it before creating an invoice."
      : gate.message;
    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href={`/estimates/${id}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to estimate
        </Link>
        <PageHeader title="Build invoice" />
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-amber-800 dark:text-amber-200">{message}</p>
            <Link
              href={`/estimates/${id}`}
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Return to estimate
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Picker shows APPROVED snapshot lines — not mutable live estimate lines.
  const lines = snapshotLinesAsEstimateLines(snap.payload);
  const byId = new Map(snap.payload.option.lines.map((l) => [l.id, l]));

  const groupMap = new Map<
    string,
    { id: string; label: string; amount: number }[]
  >();
  for (const l of lines) {
    const room = l.room?.trim() || "Whole job";
    const arr = groupMap.get(room) ?? [];
    arr.push({
      id: l.id,
      label: l.description || "Line item",
      amount: Number(byId.get(l.id)?.line_total) || 0,
    });
    groupMap.set(room, arr);
  }
  const groups = [...groupMap.entries()].map(([room, items]) => ({
    room,
    items,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/estimates/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to estimate
      </Link>
      <PageHeader
        title="Build invoice"
        description={`Approved commercial charges (v${snap.version}). Pick items for this invoice (e.g. a deposit, or the full job).`}
      />

      {lines.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              This approval has no line items to invoice.
            </p>
          </CardContent>
        </Card>
      ) : (
        <InvoiceLinePicker estimateId={estimate.id} groups={groups} />
      )}
    </div>
  );
}

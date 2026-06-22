import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getEstimate } from "@/lib/data/estimates";
import { lineTotal } from "@/lib/estimate-calc";
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

  const opts = estimate.options ?? [];
  const opt =
    (estimate.accepted_option_id &&
      opts.find((o) => o.id === estimate.accepted_option_id)) ||
    opts[0];
  const lines = opt?.line_items ?? [];

  // Compartmentalize the lines by room (job-level items → "Whole job").
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
      amount: lineTotal(l),
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
        description="Pick the items to put on this invoice (e.g. a deposit, or the full job)."
      />

      {lines.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              This estimate has no line items to invoice.
            </p>
          </CardContent>
        </Card>
      ) : (
        <InvoiceLinePicker estimateId={estimate.id} groups={groups} />
      )}
    </div>
  );
}

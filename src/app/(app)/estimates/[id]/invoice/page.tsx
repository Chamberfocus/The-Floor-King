import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Receipt } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getEstimate } from "@/lib/data/estimates";
import { lineTotal } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";
import { createInvoiceFromSelection } from "../../../invoices/actions";

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {opt?.name ?? "Estimate"} items
          </CardTitle>
        </CardHeader>
        <CardContent>
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This estimate has no line items to invoice.
            </p>
          ) : (
            <form action={createInvoiceFromSelection} className="space-y-3">
              <input type="hidden" name="estimate_id" value={estimate.id} />
              <ul className="divide-y">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      name="line"
                      value={l.id}
                      defaultChecked
                      className="size-4 rounded border-input"
                    />
                    <span className="flex-1 text-sm">
                      {l.room ? `${l.room} — ` : ""}
                      {l.description || "Line item"}
                    </span>
                    <span className="text-sm font-medium">
                      {formatMoney(lineTotal(l))}
                    </span>
                  </li>
                ))}
              </ul>
              <Button type="submit">
                <Receipt className="size-4" /> Create invoice from selected
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

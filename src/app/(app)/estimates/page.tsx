import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { listAllEstimates, type EstimateListRow } from "@/lib/data/estimates";
import { optionTotals } from "@/lib/estimate-calc";
import { formatMoney, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Estimates" };

function headlineTotal(e: EstimateListRow): number {
  const opts = e.options ?? [];
  const opt =
    (e.accepted_option_id && opts.find((o) => o.id === e.accepted_option_id)) ||
    opts[0];
  if (!opt) return 0;
  return optionTotals(opt.line_items ?? [], e.tax_rate).total;
}

export default async function EstimatesPage() {
  const estimates = await listAllEstimates();

  return (
    <div>
      <PageHeader
        title="Estimates"
        description="Every quote across all customers."
      >
        <Link href="/estimates/start" className={buttonVariants({ size: "lg" })}>
          <Plus className="size-4" /> New estimate
        </Link>
      </PageHeader>

      {estimates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No estimates yet. Open a customer and click{" "}
            <span className="font-medium">New estimate</span> to build your first
            quote.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estimate</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Link href={`/estimates/${e.id}`} className="hover:underline">
                      {e.title || "Estimate"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {(e.options ?? []).length} option
                      {(e.options ?? []).length === 1 ? "" : "s"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/customers/${e.customer_id}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {e.customer_name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <EstimateStatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(headlineTotal(e))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(e.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

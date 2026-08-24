import type { Metadata } from "next";
import Link from "next/link";
import { Plus, FileText } from "lucide-react";
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
import { EmptyState } from "@/components/empty-state";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { listAllEstimates, type EstimateListRow } from "@/lib/data/estimates";
import { optionTotals } from "@/lib/estimate-calc";
import { formatMoney, formatDate } from "@/lib/format";
import { DeleteEstimateButton, ClearDraftsButton } from "./estimate-list-actions";

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
        description="Every estimate across all customers."
      >
        {/* "Quick estimate" used to sit here as its own button — the only place
            in the app you could reach it. It's one of the four choices inside
            New estimate now, offered wherever you start one. */}
        <div className="flex items-center gap-2">
          <ClearDraftsButton />
          <Link href="/estimates/start" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> New estimate
          </Link>
        </div>
      </PageHeader>

      {estimates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No estimates yet — let's build your first one"
          description="Find the customer, then pick how to build it: the guided questionnaire, a quick few lines, or straight into the builder."
          action={
            <Link href="/estimates/start" className={buttonVariants({})}>
              <Plus className="size-4" /> New estimate
            </Link>
          }
        />
      ) : (
        <>
        {/* Phone: tappable cards (delete sits outside the link) */}
        <div className="space-y-2 md:hidden">
          {estimates.map((e) => (
            <div key={e.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/estimates/${e.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.title || "Estimate"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.customer_name ?? "—"} · {(e.options ?? []).length} option
                    {(e.options ?? []).length === 1 ? "" : "s"}
                  </div>
                </Link>
                <EstimateStatusBadge status={e.status} />
                <DeleteEstimateButton id={e.id} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{formatMoney(headlineTotal(e))}</span>
                <span className="ml-auto">{formatDate(e.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Larger screens: table */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estimate</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-10"></TableHead>
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
                  <TableCell className="text-right">
                    <DeleteEstimateButton id={e.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  );
}

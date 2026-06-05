import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Check,
  Wrench,
  ShoppingCart,
  Receipt,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { getEstimate } from "@/lib/data/estimates";
import { getCustomer } from "@/lib/data/customers";
import { optionTotals, lineTotal } from "@/lib/estimate-calc";
import { formatMoney, formatDate } from "@/lib/format";
import type { EstimateLineItem, EstimateOption } from "@/lib/types";
import { setEstimateStatus, deleteEstimate } from "../actions";
import { createJobFromEstimate } from "@/app/(app)/jobs/actions";
import { createPOFromEstimate } from "@/app/(app)/purchase-orders/actions";
import { createInvoiceFromEstimate } from "@/app/(app)/invoices/actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const estimate = await getEstimate(id);
  return { title: estimate?.title ?? "Estimate" };
}

function lineMath(l: EstimateLineItem): string {
  if (l.line_type === "flat") return "Flat amount";
  const sqft = l.sqft ?? 0;
  if (l.line_type === "installed") {
    return `${sqft} sq ft × ${formatMoney(l.installed_rate ?? 0)}`;
  }
  return `${sqft} sq ft × ${formatMoney(
    (l.material_rate ?? 0) + (l.labor_rate ?? 0),
  )} (mat + labor)`;
}

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimate(id);
  if (!estimate) notFound();

  const customer = await getCustomer(estimate.customer_id);
  const options = estimate.options ?? [];
  const detailed = estimate.presentation === "detailed";

  const totalsFor = (o: EstimateOption) =>
    optionTotals(o.line_items ?? [], estimate.tax_rate);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/customers/${estimate.customer_id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customer?.full_name ?? "customer"}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {estimate.title || "Estimate"}
            </h1>
            <EstimateStatusBadge status={estimate.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customer?.full_name} · Created {formatDate(estimate.created_at)} ·{" "}
            {detailed ? "Itemized" : "Lump sum"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/estimates/${estimate.id}/edit`}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <Pencil className="size-4" /> Edit
          </Link>
          {estimate.status === "approved" ? (
            <>
              <form action={createJobFromEstimate}>
                <input type="hidden" name="estimate_id" value={estimate.id} />
                <Button type="submit" size="lg">
                  <Wrench className="size-4" /> Create job
                </Button>
              </form>
              <form action={createPOFromEstimate}>
                <input type="hidden" name="estimate_id" value={estimate.id} />
                <Button type="submit" variant="outline" size="lg">
                  <ShoppingCart className="size-4" /> Create PO
                </Button>
              </form>
              <form action={createInvoiceFromEstimate}>
                <input type="hidden" name="estimate_id" value={estimate.id} />
                <Button type="submit" variant="outline" size="lg">
                  <Receipt className="size-4" /> Create invoice
                </Button>
              </form>
            </>
          ) : null}
        </div>
      </div>

      {estimate.job_description ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Job description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {estimate.job_description}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Options */}
      <div className="space-y-4">
        {options.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No options yet.{" "}
              <Link
                href={`/estimates/${estimate.id}/edit`}
                className="underline"
              >
                Build this estimate
              </Link>
              .
            </CardContent>
          </Card>
        ) : (
          options.map((option) => {
            const totals = totalsFor(option);
            const accepted = estimate.accepted_option_id === option.id;
            return (
              <Card
                key={option.id}
                className={accepted ? "ring-2 ring-green-500" : ""}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base">
                    {option.name}
                    {accepted ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-green-600">
                        <Check className="size-3.5" /> Accepted
                      </span>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {detailed ? (
                    <div className="divide-y text-sm">
                      {(option.line_items ?? []).map((l) => (
                        <div
                          key={l.id}
                          className="flex items-start justify-between gap-4 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium">
                              {l.room ? `${l.room} — ` : ""}
                              {l.description || "Line item"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {lineMath(l)}
                            </div>
                          </div>
                          <div className="shrink-0 font-medium">
                            {formatMoney(lineTotal(l))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Itemized breakdown hidden — customer sees a single total.
                    </p>
                  )}

                  <div className="ml-auto mt-3 w-full max-w-xs space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{formatMoney(totals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Tax ({estimate.tax_rate}%)</span>
                      <span>{formatMoney(totals.tax)}</span>
                    </div>
                    <div className="flex justify-between text-base font-semibold">
                      <span>Total</span>
                      <span>{formatMoney(totals.total)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Status workflow */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Status &amp; workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {estimate.customer_response_note ? (
            <p className="rounded-md bg-muted p-3">
              <span className="font-medium">Customer response:</span>{" "}
              {estimate.customer_response_note}
            </p>
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            {estimate.status === "draft" ? (
              <form action={setEstimateStatus}>
                <input type="hidden" name="id" value={estimate.id} />
                <input type="hidden" name="status" value="sent" />
                <Button type="submit">Mark as sent</Button>
              </form>
            ) : null}

            {estimate.status !== "approved" && options.length > 0 ? (
              <form action={setEstimateStatus} className="flex items-end gap-2">
                <input type="hidden" name="id" value={estimate.id} />
                <input type="hidden" name="status" value="approved" />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Accept which option?
                  </label>
                  <select
                    name="accepted_option_id"
                    defaultValue={options[0]?.id}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                  >
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} — {formatMoney(totalsFor(o).total)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" variant="default">
                  Mark approved
                </Button>
              </form>
            ) : null}
          </div>

          {estimate.status !== "approved" ? (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-muted-foreground">
                Record a decline or change request
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <form action={setEstimateStatus} className="space-y-2">
                  <input type="hidden" name="id" value={estimate.id} />
                  <input type="hidden" name="status" value="declined" />
                  <textarea
                    name="customer_response_note"
                    rows={2}
                    required
                    placeholder="Reason for declining…"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <Button type="submit" variant="destructive" size="sm">
                    Mark declined
                  </Button>
                </form>
                <form action={setEstimateStatus} className="space-y-2">
                  <input type="hidden" name="id" value={estimate.id} />
                  <input type="hidden" name="status" value="changes_requested" />
                  <textarea
                    name="customer_response_note"
                    rows={2}
                    required
                    placeholder="What changes are requested?"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <Button type="submit" variant="outline" size="sm">
                    Request changes
                  </Button>
                </form>
              </div>
            </details>
          ) : null}

          {estimate.status === "approved" ? (
            <form action={setEstimateStatus}>
              <input type="hidden" name="id" value={estimate.id} />
              <input type="hidden" name="status" value="sent" />
              <Button type="submit" variant="outline" size="sm">
                Reopen (back to sent)
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <form
        action={deleteEstimate}
        className="mt-4 flex justify-end"
      >
        <input type="hidden" name="id" value={estimate.id} />
        <input type="hidden" name="customer_id" value={estimate.customer_id} />
        <Button type="submit" variant="destructive" size="sm">
          <Trash2 className="size-3.5" /> Delete estimate
        </Button>
      </form>
    </div>
  );
}

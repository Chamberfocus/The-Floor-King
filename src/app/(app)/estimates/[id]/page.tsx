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
  LayoutDashboard,
  Copy,
  Send,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { SegmentedField } from "@/components/ui/segmented-field";
import { getEstimate, getEstimatorName } from "@/lib/data/estimates";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { optionTotalsWithDiscount, lineTotal, lineQty } from "@/lib/estimate-calc";
import { formatMoney, formatDate } from "@/lib/format";
import type { EstimateLineItem, EstimateOption } from "@/lib/types";
import { setEstimateStatus, duplicateOption } from "../actions";
import { DeleteEstimateButton } from "../estimate-list-actions";
import { createJobFromEstimate } from "@/app/(app)/jobs/actions";
import { createPOFromEstimate } from "@/app/(app)/purchase-orders/actions";
import { CopyEstimate } from "./copy-estimate";
import { AddFromNotes } from "./add-from-notes";
import {
  EstimatePrintDoc,
  PrintEstimateButton,
  EstimateNotesEditor,
  AutoPrint,
} from "./estimate-print";

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
  const qty = lineQty(l);
  const unit =
    (l.unit && l.unit.trim()) || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft");
  const rate =
    l.line_type === "installed"
      ? (l.installed_rate ?? 0)
      : (l.material_rate ?? 0) + (l.labor_rate ?? 0);
  return `${qty.toFixed(2)} ${unit} × ${formatMoney(rate)}`;
}

export default async function EstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { id } = await params;
  const { print } = await searchParams;
  const estimate = await getEstimate(id);
  if (!estimate) notFound();

  const customer = await getCustomer(estimate.customer_id);
  const org = await getOrgSettings();
  const preparedBy = await getEstimatorName(estimate.created_by);
  const options = estimate.options ?? [];
  const detailed = estimate.presentation === "detailed";

  const totalsFor = (o: EstimateOption) =>
    optionTotalsWithDiscount(
      o.line_items ?? [],
      estimate.tax_rate,
      estimate.discount_kind,
      estimate.discount_value,
    );

  return (
    <>
      {print ? <AutoPrint /> : null}
      <EstimatePrintDoc
        org={org}
        customer={customer}
        estimate={estimate}
        preparedBy={preparedBy}
      />
      <div className="mx-auto max-w-4xl print:hidden">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href={`/customers/${estimate.customer_id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to {customer?.full_name ?? "customer"}
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <LayoutDashboard className="size-4" /> Dashboard
        </Link>
      </div>

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
          <PrintEstimateButton />
          <CopyEstimate estimateId={estimate.id} />
        </div>
      </div>

      {/* Next steps — the obvious "what now", tuned to where the estimate is */}
      <Card className="mb-6 border-primary/40 print:hidden">
        <CardContent className="pt-6">
          {estimate.status === "approved" ? (
            <>
              <div className="mb-1 font-semibold">Next steps</div>
              <p className="mb-4 text-sm text-muted-foreground">
                Everything below is pre-filled from this estimate — no re-typing.
                Materials become the PO, labor &amp; scope become the work order,
                and billing becomes the invoice.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <form action={createJobFromEstimate}>
                  <input type="hidden" name="estimate_id" value={estimate.id} />
                  <SubmitButton size="lg" className="w-full" pendingText="Creating…" confirm={null}>
                    <Wrench className="size-4" /> Create work order
                  </SubmitButton>
                </form>
                <form action={createPOFromEstimate}>
                  <input type="hidden" name="estimate_id" value={estimate.id} />
                  <SubmitButton variant="outline" size="lg" className="w-full" pendingText="Creating…" confirm={null}>
                    <ShoppingCart className="size-4" /> Create PO
                  </SubmitButton>
                </form>
                <Link
                  href={`/estimates/${estimate.id}/invoice`}
                  className={buttonVariants({ variant: "outline", size: "lg", className: "w-full" })}
                >
                  <Receipt className="size-4" /> Create invoice
                </Link>
              </div>
            </>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add at least one priced option to send or approve this estimate.
            </p>
          ) : estimate.status === "draft" ? (
            customer?.email ? (
              // Draft with an email on file → the next action is SEND.
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">Ready to send?</div>
                  <p className="text-sm text-muted-foreground">
                    Email this estimate to {customer.full_name} at {customer.email}{" "}
                    so they can review, approve, or request changes.
                  </p>
                </div>
                <form action={setEstimateStatus}>
                  <input type="hidden" name="id" value={estimate.id} />
                  <input type="hidden" name="status" value="sent" />
                  <SubmitButton size="lg" pendingText="Sending…" confirm="Estimate sent">
                    <Send className="size-4" /> Send to customer
                  </SubmitButton>
                </form>
              </div>
            ) : (
              // Draft with NO email → don't pretend it can be emailed.
              <div className="space-y-3">
                <div>
                  <div className="font-semibold text-amber-700 dark:text-amber-500">
                    No email on file for {customer?.full_name ?? "this customer"}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    This estimate can&apos;t be emailed. Add an email to send it, or
                    print/PDF it to hand off — then mark it sent.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/customers/${estimate.customer_id}`}
                    className={buttonVariants({ size: "lg" })}
                  >
                    <Send className="size-4" /> Add an email
                  </Link>
                  <PrintEstimateButton />
                  <form action={setEstimateStatus}>
                    <input type="hidden" name="id" value={estimate.id} />
                    <input type="hidden" name="status" value="sent" />
                    <SubmitButton variant="outline" size="lg" pendingText="Saving…" confirm="Marked as sent">
                      Mark as sent anyway
                    </SubmitButton>
                  </form>
                </div>
              </div>
            )
          ) : estimate.status === "sent" || estimate.status === "changes_requested" ? (
            // Sent → waiting on the customer; approving lives in the workflow card.
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">
                  {estimate.status === "changes_requested"
                    ? "Changes requested"
                    : "Sent — waiting on the customer"}
                </div>
                <p className="text-sm text-muted-foreground">
                  {estimate.status === "changes_requested"
                    ? "The customer asked for changes. Update the estimate, then re-send."
                    : "When they approve (or you approve it for them below), the work order, PO & invoice unlock."}
                </p>
              </div>
              <form action={setEstimateStatus} className="flex items-end gap-2">
                <input type="hidden" name="id" value={estimate.id} />
                <input type="hidden" name="status" value="approved" />
                <input
                  type="hidden"
                  name="accepted_option_id"
                  value={estimate.accepted_option_id || options[0].id}
                />
                <SubmitButton size="lg" pendingText="Approving…" confirm="Approved">
                  <Check className="size-4" /> Approve &amp; continue
                </SubmitButton>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Ready to go?</div>
                <p className="text-sm text-muted-foreground">
                  Approve this estimate to unlock the work order, PO &amp; invoice.
                </p>
              </div>
              <form action={setEstimateStatus} className="flex items-end gap-2">
                <input type="hidden" name="id" value={estimate.id} />
                <input type="hidden" name="status" value="approved" />
                <input
                  type="hidden"
                  name="accepted_option_id"
                  value={estimate.accepted_option_id || options[0].id}
                />
                <SubmitButton size="lg" pendingText="Approving…" confirm="Approved">
                  <Check className="size-4" /> Approve &amp; continue
                </SubmitButton>
              </form>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* Keep building from notes — append more rooms / add-ons */}
      <Card className="mb-6 border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" /> Add more from notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AddFromNotes estimateId={estimate.id} customerId={estimate.customer_id} />
        </CardContent>
      </Card>

      {/* Notes — shown to the customer on the estimate & the printed/PDF copy */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Notes on the estimate</CardTitle>
        </CardHeader>
        <CardContent>
          <EstimateNotesEditor estimateId={estimate.id} notes={estimate.notes} />
        </CardContent>
      </Card>

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
                  <form action={duplicateOption}>
                    <input type="hidden" name="estimate_id" value={estimate.id} />
                    <input type="hidden" name="option_id" value={option.id} />
                    <Button type="submit" variant="ghost" size="sm" title="Duplicate this option (good / better / best)">
                      <Copy className="size-3.5" /> Copy to option
                    </Button>
                  </form>
                </CardHeader>
                <CardContent>
                  {!detailed ? (
                    <p className="mb-2 rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                      You see every line here. The customer&apos;s copy shows a
                      single lump-sum total.
                    </p>
                  ) : null}
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
                            {l.from_stock ? (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                From stock
                              </span>
                            ) : null}
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

                  <div className="ml-auto mt-3 w-full max-w-xs space-y-1 border-t pt-3 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span>{formatMoney(totals.subtotal)}</span>
                    </div>
                    {totals.discount > 0 ? (
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                        <span>Discount</span>
                        <span>−{formatMoney(totals.discount)}</span>
                      </div>
                    ) : null}
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
            {estimate.status !== "approved" && options.length > 0 ? (
              <form action={setEstimateStatus} className="flex items-end gap-2">
                <input type="hidden" name="id" value={estimate.id} />
                <input type="hidden" name="status" value="approved" />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Accept which option?
                  </label>
                  <SegmentedField
                    name="accepted_option_id"
                    defaultValue={options[0]?.id}
                    options={options.map((o) => ({
                      value: o.id,
                      label: `${o.name} — ${formatMoney(totalsFor(o).total)}`,
                    }))}
                  />
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
      <div className="mt-4 flex justify-end">
        <DeleteEstimateButton id={estimate.id} customerId={estimate.customer_id} variant="full" />
      </div>
      </div>
    </>
  );
}

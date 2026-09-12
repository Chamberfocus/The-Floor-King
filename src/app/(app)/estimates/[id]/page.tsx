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
import { ConfirmButton } from "@/components/ui/confirm-button";
import { SendToClient } from "@/components/send-to-client";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { EstimateDeliveryCard } from "@/components/estimate-delivery-card";
import { getEstimateDelivery } from "@/lib/data/estimate-delivery";
import { SegmentedField } from "@/components/ui/segmented-field";
import { getEstimate, getEstimatorName } from "@/lib/data/estimates";
import { getCurrentApprovalSnapshot } from "@/lib/data/estimate-approvals";
import { legacyApprovalSnapshotUnavailable } from "@/lib/estimate-approval";
import { getCustomer } from "@/lib/data/customers";
import { getOrgSettings } from "@/lib/data/org";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { requireProfile } from "@/lib/auth";
import {
  optionTotalsWithDiscount,
  lineTotal,
  lineQty,
} from "@/lib/estimate-calc";
import { jobProfit } from "@/lib/job-profit";
import { parseProjectDetails } from "@/lib/customer-scope";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EstimateLineItem, EstimateOption } from "@/lib/types";
import { setEstimateStatus, duplicateOption, unapproveEstimate } from "../actions";
import { DeleteEstimateButton } from "../estimate-list-actions";
import { createJobFromEstimate } from "@/app/(app)/jobs/actions";
import { createClient } from "@/lib/supabase/server";
import { jobMaterialsHref } from "@/lib/job-materials-href";
import { CopyEstimate } from "./copy-estimate";
import { EstimateAddress } from "./estimate-address";
import { AddFromNotes } from "./add-from-notes";
import {
  EstimatePrintDoc,
  PrintEstimateButton,
  EstimateNotesEditor,
  EstimateCustomerControls,
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
  searchParams: Promise<{ print?: string; preview?: string; approval_error?: string; invoice_error?: string; notify?: string; notify_detail?: string }>;
}) {
  const { id } = await params;
  const { print, preview: previewParam, approval_error: approvalError, invoice_error: invoiceError, notify, notify_detail: notifyDetail } = await searchParams;
  const preview = previewParam === "1";
  const estimate = await getEstimate(id);
  if (!estimate) notFound();
  const approvalSnap = await getCurrentApprovalSnapshot(id);

  const customer = await getCustomer(estimate.customer_id);
  const supabase = await createClient();
  const { data: linkedJob } = await supabase
    .from("jobs")
    .select("id")
    .eq("estimate_id", id)
    .maybeSingle();
  // Which property this estimate is for. Only meaningful on accounts that have
  // more than one — but it has to be READABLE on all of them, or a wrong one
  // stays invisible until a crew turns up at the wrong door.
  const svcAddrId = (estimate as { service_address_id?: string | null })
    .service_address_id ?? null;
  const siteAddress = svcAddrId
    ? ((
        await supabase
          .from("service_addresses")
          .select("id, label, street, city, state, zip")
          .eq("id", svcAddrId)
          .maybeSingle()
      ).data as {
        id: string; label: string | null; street: string | null;
        city: string | null; state: string | null; zip: string | null;
      } | null)
    : null;
  const org = await getOrgSettings();
  const preparedBy = await getEstimatorName(estimate.created_by);
  const delivery = await getEstimateDelivery(id);
  const options = estimate.options ?? [];
  const detailed = estimate.presentation === "detailed";

  const totalsFor = (o: EstimateOption) =>
    optionTotalsWithDiscount(
      o.line_items ?? [],
      estimate.tax_rate,
      estimate.discount_kind,
      estimate.discount_value,
    );

  // Owner-only internal profit: canonical jobProfit (same as builder / invoice).
  // Never shown to the customer (this whole page is staff-facing; the customer's
  // copy is EstimatePrintDoc above).
  const profile = await requireProfile();
  const biz = profile.role === "admin" ? await getBusinessSettings() : null;
  const profitFor = (o: EstimateOption) => {
    if (!biz) return null;
    const p = jobProfit(o.line_items ?? [], {
      discountKind: estimate.discount_kind,
      discountValue: estimate.discount_value,
      freightMarkupPct: org.freight_markup_pct,
      fuelFee: biz.job_fuel_fee,
      carAllowance: biz.job_car_allowance,
      commissionPct: biz.job_commission_pct,
    });
    const hasRev = p.revenue > 0;
    return {
      revenue: p.revenue,
      fuelCharge: hasRev ? Number(biz.job_fuel_charge) || 0 : 0,
      material: p.material,
      labor: p.labor,
      cost: p.cost,
      salesGas: p.fuelFee,
      carAllowance: p.carAllowance,
      commissionPct: p.commissionPct,
      commission: p.commission,
      profit: p.profit,
      margin: p.margin,
    };
  };

  return (
    <>
      {print ? <AutoPrint /> : null}
      <EstimatePrintDoc
        org={org}
        customer={customer}
        estimate={estimate}
        siteAddress={siteAddress}
        preparedBy={preparedBy}
        preview={preview}
      />
      <div className={`mx-auto max-w-4xl print:hidden${preview ? " hidden" : ""}`}>
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
            <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
              {estimate.title || "Estimate"}
            </h1>
            <EstimateStatusBadge status={estimate.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {customer?.full_name} · Created {formatDate(estimate.created_at)} ·{" "}
            {detailed ? "Itemized" : "Lump sum"}
          </p>
          <div className="mt-2">
            <EstimateAddress
              estimateId={estimate.id}
              customerId={estimate.customer_id}
              current={siteAddress}
              billingAddress={
                customer
                  ? [
                      customer.street,
                      [customer.city, customer.state].filter(Boolean).join(", "),
                      customer.zip,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : ""
              }
            />
          </div>
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

      {/* Customer copy — itemized vs lump sum, and whether the captured
          questionnaire answers appear (print / PDF / portal). Presentation only. */}
      <div className="mb-6 print:hidden">
        <EstimateCustomerControls
          estimateId={estimate.id}
          presentation={estimate.presentation}
          showProjectDetails={estimate.show_project_details}
        />
      </div>

      {/* Step 6 — commercial vs ops / approval history */}
      <div className="mb-4 space-y-2 print:hidden">
        {approvalError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {approvalError}
          </p>
        ) : null}
        {invoiceError ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {invoiceError}
          </p>
        ) : null}
        {notify === "success" ? (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            Email sent to the customer.
          </p>
        ) : null}
        {notify === "failed" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Estimate was updated, but the email failed: {notifyDetail || "send failed."}
          </p>
        ) : null}
        {notify === "not_attempted" ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Estimate was updated. Email was not sent: {notifyDetail || "not attempted."}
          </p>
        ) : null}
        {estimate.status === "approved" && approvalSnap ? (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            Customer approval on file (v{approvalSnap.version}
            {estimate.approved_at
              ? ` · ${formatDate(estimate.approved_at)}`
              : ""}
            ). Editing the live estimate does not change that snapshot, the job,
            POs, or invoices. Material price/qty changes will require reapproval.
          </p>
        ) : null}
        {legacyApprovalSnapshotUnavailable(estimate.status, !!approvalSnap) ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Historical approval snapshot unavailable — this was approved before
            approval history was recorded. Do not treat the live estimate as a
            verified original acceptance.
          </p>
        ) : null}
        {estimate.approval_stale ||
        (estimate.status === "sent" && approvalSnap) ? (
          <p className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
            Revised commercial proposal awaiting customer reapproval. Previous
            approval (v{approvalSnap?.version ?? "?"}) is preserved. Job scope,
            POs, and invoices were not updated automatically
            {approvalSnap
              ? ` — approved total was ${formatMoney(approvalSnap.payload.total)}`
              : ""}
            .
          </p>
        ) : null}
      </div>

      {/* Next steps — the obvious "what now", tuned to where the estimate is */}
      <Card className="mb-6 border-primary/40 print:hidden">
        <CardContent className="pt-6">
          {estimate.status === "approved" ? (
            <>
              <div className="mb-1 font-semibold">Next steps</div>
              <p className="mb-4 text-sm text-muted-foreground">
                Job materials and work order use the job&apos;s operational scope
                after the job exists — editing this estimate later does not
                rewrite them. Create a job, order materials, or raise an invoice
                from the current commercial record when ready.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <form action={createJobFromEstimate}>
                  <input type="hidden" name="estimate_id" value={estimate.id} />
                  <ConfirmButton
                    size="lg"
                    className="w-full"
                    title="Create a job from this estimate?"
                    description="Builds a work order from this estimate's scope, labor, and materials."
                    confirmLabel="Create job"
                  >
                    <Wrench className="size-4" /> Create job
                  </ConfirmButton>
                </form>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  render={
                    <Link
                      href={
                        linkedJob?.id
                          ? jobMaterialsHref(linkedJob.id as string)
                          : `/estimates/${estimate.id}/order`
                      }
                    />
                  }
                >
                  <ShoppingCart className="size-4" /> Order materials
                </Button>
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
                  <SendToClient
                    size="lg"
                    clientName={customer.full_name}
                    email={customer.email}
                    title={`Send this estimate to ${customer.full_name}?`}
                    description="They'll get your branded estimate email with a link to review, approve, or request changes."
                    sendLabel="Send estimate"
                    skipLabel="Mark sent, no email"
                  >
                    <Send className="size-4" /> Send to customer
                  </SendToClient>
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
                    <ConfirmButton
                      variant="outline"
                      size="lg"
                      title="Mark this estimate as sent?"
                      description="Flips the estimate to Sent and advances the customer's pipeline stage, without emailing anything."
                      confirmLabel="Mark as sent"
                    >
                      Mark as sent anyway
                    </ConfirmButton>
                  </form>
                </div>
              </div>
            )
          ) : estimate.status === "sent" || estimate.status === "changes_requested" ? (
            // Sent → waiting on the customer; approving lives in the workflow card
            // (option picker). Do not duplicate Approve here — that locked option 1.
            <div className="space-y-4">
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
                    : "When they approve (or you approve the chosen option in Status & workflow below), the job, PO & invoice unlock."}
                </p>
              </div>
            </div>
            {/* Did it land, and have they read it? */}
            <EstimateDeliveryCard d={delivery} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Ready to go?</div>
                <p className="text-sm text-muted-foreground">
                  Approve the chosen option in Status &amp; workflow below to unlock the work order, PO &amp; invoice.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(() => {
        const { details, flags } = parseProjectDetails(estimate.job_description);
        if (!details.length && !flags.length) return null;
        return (
          <Card className="mb-6 print:hidden">
            <CardHeader>
              <CardTitle className="text-base">Project details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {details.length ? (
                <ul className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                  {details.map((d, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-40" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {flags.length ? (
                <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
                  <div className="mb-1 font-medium text-amber-800 dark:text-amber-300">
                    Internal flags — never shown to the customer
                  </div>
                  <ul className="list-disc space-y-0.5 pl-5 text-amber-800 dark:text-amber-200">
                    {flags.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {estimate.show_project_details
                  ? "The details list above appears on the customer copy — toggle it above. Internal flags stay internal."
                  : "The details list above is hidden from the customer copy — toggle it above to include it. Internal flags stay internal."}
              </p>
            </CardContent>
          </Card>
        );
      })()}

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
          <CardTitle className="text-base">Description — fills the estimate body</CardTitle>
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

                  {/* Owner-only profit — fuel charge (in the price) + our cost,
                      gas, car allowance, commission → true profit. Internal. */}
                  {(() => {
                    const p = profitFor(option);
                    if (!p) return null;
                    return (
                      <div className="ml-auto mt-2 w-full max-w-xs space-y-1 rounded-md border border-dashed p-3 text-sm">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Profit — internal, not shown to customer
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Revenue (pre-tax)</span>
                          <span className="tabular-nums">{formatMoney(p.revenue)}</span>
                        </div>
                        {p.fuelCharge > 0 ? (
                          <div className="flex justify-between pl-3 text-xs text-muted-foreground/80">
                            <span>↳ incl. {formatMoney(p.fuelCharge)} fuel charge</span>
                          </div>
                        ) : null}
                        <div className="flex justify-between text-muted-foreground">
                          <span>Our cost</span>
                          <span className="tabular-nums">−{formatMoney(p.cost)}</span>
                        </div>
                        {p.material > 0 || p.labor > 0 ? (
                          <div className="flex justify-between pl-3 text-xs text-muted-foreground/80">
                            <span>
                              ↳ Material {formatMoney(p.material)} · Labor{" "}
                              {formatMoney(p.labor)}
                            </span>
                          </div>
                        ) : null}
                        {p.salesGas > 0 ? (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Salesperson gas</span>
                            <span className="tabular-nums">−{formatMoney(p.salesGas)}</span>
                          </div>
                        ) : null}
                        {p.carAllowance > 0 ? (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Car allowance</span>
                            <span className="tabular-nums">−{formatMoney(p.carAllowance)}</span>
                          </div>
                        ) : null}
                        {p.commission > 0 ? (
                          <div className="flex justify-between text-muted-foreground">
                            <span>Commission ({p.commissionPct}%)</span>
                            <span className="tabular-nums">−{formatMoney(p.commission)}</span>
                          </div>
                        ) : null}
                        <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                          <span>Profit</span>
                          <span
                            className={cn(
                              "tabular-nums",
                              p.profit >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive",
                            )}
                          >
                            {formatMoney(p.profit)}
                            <span className="ml-2 text-xs font-medium">
                              {p.margin.toFixed(1)}%
                            </span>
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Status workflow */}
      <Card id="workflow" className="mt-6">
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
                <ConfirmButton
                  variant="default"
                  title="Approve this estimate?"
                  description="This accepts the chosen option, creates the job, moves the customer to Collect Deposit, and notifies the office."
                  confirmLabel="Approve"
                >
                  Mark approved
                </ConfirmButton>
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
                  <ConfirmButton
                    variant="destructive"
                    size="sm"
                    title="Mark this estimate as declined?"
                    description="Records the estimate as declined with the reason above."
                    confirmLabel="Mark declined"
                    destructive
                  >
                    Mark declined
                  </ConfirmButton>
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

          {/* APPROVED → a real undo. Approving creates a job, reserves stock,
              raises POs and moves the customer to Collect Deposit; the old
              "Reopen" only flipped the status and left all of that behind. */}
          {estimate.status === "approved" ? (
            <form action={unapproveEstimate}>
              <input type="hidden" name="id" value={estimate.id} />
              <ConfirmButton
                variant="outline"
                size="sm"
                title="Undo this approval?"
                description="Puts the estimate back to Sent, removes the job it created, deletes any draft purchase orders and releases reserved material. The customer goes back to Awaiting Customer Response. Refuses if the job has already been invoiced, scheduled, or had material received."
                confirmLabel="Undo approval"
              >
                Undo approval
              </ConfirmButton>
            </form>
          ) : null}

          {/* Reopening a DECLINED estimate — including one declined by a mis-tap
              in the portal, where the customer has no way back either. */}
          {estimate.status === "declined" ? (
            <form action={setEstimateStatus}>
              <input type="hidden" name="id" value={estimate.id} />
              <input type="hidden" name="status" value="sent" />
              {/* Don't re-email on a reopen from declined — they said no; the
                  rep will follow up in person. */}
              <input type="hidden" name="send_email" value="no" />
              <ConfirmButton
                variant="outline"
                size="sm"
                title="Put this estimate back in play?"
                description="Moves it back to Sent so you can revise it or take another run at it. The customer is NOT emailed."
                confirmLabel="Reopen"
              >
                Put back in play
              </ConfirmButton>
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

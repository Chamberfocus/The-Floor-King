import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { requireProfile } from "@/lib/auth";
import { getBill, sourceBadge } from "@/lib/data/bills";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  recordBillPayment,
  voidBillPayment,
  updateBillMeta,
  voidBill,
  activateBill,
} from "../actions";

export const metadata: Metadata = { title: "Bill" };
export const dynamic = "force-dynamic";

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];

export default async function BillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office"].includes(profile.role)) redirect("/");
  const { id } = await params;
  const bill = await getBill(id);
  if (!bill) notFound();

  const installerLinked = !!(bill.installer_labor_bill_id || bill.source_type === "installer_labor");
  const isDraft = bill.status === "draft";
  const isVoid = bill.status === "void";
  const canPay = !isDraft && !isVoid && !["paid"].includes(bill.status) && bill.balance > 0.005;
  const canVoidUnpaid = !installerLinked && !isVoid && bill.paid <= 0.005;

  const statusCls =
    bill.status === "paid"
      ? "bg-emerald-500/10 text-emerald-600"
      : bill.status === "partial"
        ? "bg-blue-500/10 text-blue-600"
        : bill.status === "void"
          ? "bg-destructive/10 text-destructive"
          : bill.status === "draft"
            ? "bg-muted text-muted-foreground"
            : "bg-amber-500/10 text-amber-600";

  const statusLabel =
    bill.status === "paid"
      ? "Paid"
      : bill.status === "partial"
        ? "Partially Paid"
        : bill.status === "void"
          ? "Void"
          : bill.status === "draft"
            ? "Draft"
            : "Open";

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/bills"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to bills
      </Link>

      <PageHeader title={bill.supplier || "Bill"}>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusCls)}>
          {statusLabel}
          {bill.overdue ? " · overdue" : ""}
        </span>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{sourceBadge(bill)}</span>
        {bill.po_id ? (
          <Link
            href={`/purchase-orders/${bill.po_id}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <FileText className="size-3.5" /> Source PO
          </Link>
        ) : null}
        {bill.job_id ? (
          <Link href={`/jobs/${bill.job_id}`} className="text-primary hover:underline">
            Job
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">Overhead — no job</span>
        )}
        {bill.customer_id ? (
          <Link href={`/customers/${bill.customer_id}`} className="text-primary hover:underline">
            Customer
          </Link>
        ) : null}
      </div>

      {installerLinked ? (
        <Card className="mb-4 border-amber-500/40">
          <CardContent className="p-4 text-sm">
            <p className="font-medium">Generated from installer labor</p>
            <p className="mt-1 text-muted-foreground">
              Amounts, vendor, job, and lines cannot be edited here. Correct the installer labor
              bill, then this payable updates with it.
            </p>
            {bill.installer_labor_bill_id && bill.job_id ? (
              <Link
                href={`/jobs/${bill.job_id}`}
                className="mt-2 inline-block text-primary hover:underline"
              >
                Open job labor
              </Link>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Bill details</CardTitle>
        </CardHeader>
        <CardContent>
          {isDraft && !installerLinked ? (
            <>
            <form action={updateBillMeta} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="bill_id" value={bill.id} />
              <label className="text-xs text-muted-foreground">
                Vendor invoice #
                <Input name="bill_number" defaultValue={bill.bill_number ?? ""} className="mt-1" />
              </label>
              <label className="text-xs text-muted-foreground">
                Terms
                <select
                  name="terms"
                  defaultValue={bill.terms ?? "net_30"}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {TERMS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Bill date
                <DateField
                  name="bill_date"
                  defaultValue={bill.bill_date}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Due date
                <DateField
                  name="due_date"
                  defaultValue={bill.due_date ?? ""}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                />
              </label>
              <label className="text-xs text-muted-foreground sm:col-span-2">
                Memo
                <Input name="memo" defaultValue={bill.memo ?? ""} className="mt-1" />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" size="sm" variant="outline">
                  Save draft
                </Button>
              </div>
            </form>
            <form action={activateBill} className="mt-3">
              <input type="hidden" name="bill_id" value={bill.id} />
              <ConfirmButton
                size="sm"
                title="Activate this bill?"
                description="Turns this draft into an unpaid vendor obligation. Dates, vendor, and amounts lock after activation."
                confirmLabel="Activate bill"
              >
                Activate bill
              </ConfirmButton>
            </form>
            </>
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Vendor invoice #</dt>
                <dd>{bill.bill_number || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd>{bill.accounting_category || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Bill date</dt>
                <dd>{formatDate(bill.bill_date)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Due date</dt>
                <dd>{bill.due_date ? formatDate(bill.due_date) : "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Memo</dt>
                <dd>{bill.memo || "—"}</dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(bill.items ?? []).map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2">{it.description || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {it.quantity ?? "—"} {it.unit}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {it.unit_cost != null ? formatMoney(it.unit_cost) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMoney((Number(it.quantity) || 0) * (Number(it.unit_cost) || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td colSpan={3} className="px-3 py-2 text-right">
                  Original
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(bill.total)}</td>
              </tr>
              <tr className="text-muted-foreground">
                <td colSpan={3} className="px-3 py-1 text-right">
                  Paid
                </td>
                <td className="px-3 py-1 text-right tabular-nums">−{formatMoney(bill.paid)}</td>
              </tr>
              <tr className="border-t text-base font-bold">
                <td colSpan={3} className="px-3 py-2 text-right">
                  Remaining
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(bill.balance)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(bill.payments ?? []).length ? (
            <ul className="divide-y text-sm">
              {(bill.payments ?? []).map((p) => {
                const voided = (p.status ?? "active") === "void";
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <span className={voided ? "text-muted-foreground line-through" : ""}>
                      <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatDate(p.date)}
                        {p.method ? ` · ${p.method}` : ""}
                        {p.note ? ` · ${p.note}` : ""}
                        {voided ? " · reversed" : ""}
                      </span>
                    </span>
                    {!voided && !isVoid ? (
                      <form action={voidBillPayment}>
                        <input type="hidden" name="payment_id" value={p.id} />
                        <input type="hidden" name="bill_id" value={bill.id} />
                        <input type="hidden" name="reason" value="Reversed from bills screen" />
                        <ConfirmButton
                          variant="ghost"
                          size="sm"
                          title={`Reverse this ${formatMoney(p.amount)} payment?`}
                          description="Keeps the payment on the bill as reversed history. Does not delete it."
                          confirmLabel="Reverse payment"
                          destructive
                        >
                          Reverse
                        </ConfirmButton>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          )}

          {canPay ? (
            <form
              action={recordBillPayment}
              className="flex flex-wrap items-end gap-2 border-t pt-3"
            >
              <input type="hidden" name="bill_id" value={bill.id} />
              <label className="text-xs text-muted-foreground">
                Amount
                <Input
                  name="amount"
                  type="number"
                  step="0.01"
                  defaultValue={bill.balance.toFixed(2)}
                  className="mt-1 w-28"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Date
                <DateField
                  name="date"
                  className="mt-1 h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Method
                <select
                  name="method"
                  className="mt-1 h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">—</option>
                  <option>Check</option>
                  <option>ACH</option>
                  <option>Card</option>
                  <option>Cash</option>
                </select>
              </label>
              <ConfirmButton
                size="sm"
                title="Record this bill payment?"
                description="Pays down this vendor bill. Does not create a second expense."
                confirmLabel="Record payment"
              >
                Record payment
              </ConfirmButton>
            </form>
          ) : bill.status === "paid" ? (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">
              Paid in full
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Paying a bill settles cash. Job cost was recognized when the bill was activated, not
            when money moved.
          </p>
        </CardContent>
      </Card>

      {canVoidUnpaid ? (
        <details className="ml-auto w-fit">
          <summary className="cursor-pointer list-none text-right text-xs text-muted-foreground hover:text-destructive [&::-webkit-details-marker]:hidden">
            Void bill
          </summary>
          <form action={voidBill} className="mt-2 flex flex-col items-end gap-2">
            <input type="hidden" name="bill_id" value={bill.id} />
            <input type="hidden" name="reason" value="Voided from bills screen" />
            <span className="max-w-xs text-right text-xs text-muted-foreground">
              Voids this unpaid bill. History is kept. Paid bills cannot be voided until payments
              are reversed.
            </span>
            <ConfirmButton
              variant="destructive"
              size="sm"
              title="Void this bill?"
              description="Marks the bill void. Line items and payments stay on file."
              confirmLabel="Void bill"
              destructive
            >
              Void bill
            </ConfirmButton>
          </form>
        </details>
      ) : null}
    </div>
  );
}

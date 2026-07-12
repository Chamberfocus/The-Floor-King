import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2, FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { requireProfile } from "@/lib/auth";
import { getBill } from "@/lib/data/bills";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  recordBillPayment,
  deleteBillPayment,
  updateBillMeta,
  deleteBill,
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

  const statusCls =
    bill.status === "paid"
      ? "bg-emerald-500/10 text-emerald-600"
      : bill.status === "partial"
        ? "bg-blue-500/10 text-blue-600"
        : "bg-amber-500/10 text-amber-600";

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
          {bill.status === "paid" ? "Paid" : bill.status === "partial" ? "Partial" : "Open"}
          {bill.overdue ? " · overdue" : ""}
        </span>
      </PageHeader>

      {/* Links to the source PO / job */}
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        {bill.po_id ? (
          <Link
            href={`/purchase-orders/${bill.po_id}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            <FileText className="size-3.5" /> Source PO
          </Link>
        ) : null}
        {bill.customer_id ? (
          <Link href={`/customers/${bill.customer_id}`} className="text-primary hover:underline">
            Customer
          </Link>
        ) : null}
      </div>

      {/* Bill details (editable) */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Bill details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateBillMeta} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="bill_id" value={bill.id} />
            <label className="text-xs text-muted-foreground">
              Vendor bill #
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
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" variant="outline">
                Save details
              </Button>
              <span className="ml-3 text-xs text-muted-foreground">
                Leave due date blank to auto-set it from the terms.
              </span>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Line items */}
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
                  Total
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
                  Balance due
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(bill.balance)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* Payments */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(bill.payments ?? []).length ? (
            <ul className="divide-y text-sm">
              {(bill.payments ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatDate(p.date)}
                      {p.method ? ` · ${p.method}` : ""}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                  </span>
                  <form action={deleteBillPayment}>
                    <input type="hidden" name="payment_id" value={p.id} />
                    <input type="hidden" name="bill_id" value={bill.id} />
                    <Button type="submit" variant="ghost" size="icon-sm" aria-label="Remove payment">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          )}

          {bill.balance > 0.005 ? (
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
              <Button type="submit" size="sm">
                Record payment
              </Button>
            </form>
          ) : (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">
              ✓ Paid in full
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Recording a payment posts a matching <strong>materials expense</strong> to your
            profit report automatically — no separate entry needed.
          </p>
        </CardContent>
      </Card>

      {/* Delete */}
      <details className="ml-auto w-fit">
        <summary className="cursor-pointer list-none text-right text-xs text-muted-foreground hover:text-destructive [&::-webkit-details-marker]:hidden">
          Delete bill
        </summary>
        <form action={deleteBill} className="mt-2 flex flex-col items-end gap-2">
          <input type="hidden" name="bill_id" value={bill.id} />
          <span className="max-w-xs text-right text-xs text-muted-foreground">
            Deletes this bill, its payments, and the expenses those payments posted. The source
            PO is kept. Can&apos;t be undone.
          </span>
          <Button type="submit" variant="destructive" size="sm">
            <Trash2 className="size-3.5" /> Delete bill
          </Button>
        </form>
      </details>
    </div>
  );
}

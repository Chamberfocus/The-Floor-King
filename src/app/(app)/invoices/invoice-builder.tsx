"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import {
  itemAmount,
  invoiceTotals,
  type SaveInvoiceInput,
} from "@/lib/invoice-calc";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_ORDER,
  type Invoice,
  type InvoiceStatus,
} from "@/lib/types";
import { saveInvoice } from "./actions";

interface ItemState {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
}

const inputSm =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function InvoiceBuilder({
  invoice,
  amountPaid,
}: {
  invoice: Invoice;
  amountPaid: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const keyCounter = useRef(0);
  const newKey = () => `it${keyCounter.current++}`;

  const emptyItem = (): ItemState => ({
    key: newKey(),
    description: "",
    quantity: "",
    unit: "sqft",
    rate: "",
  });

  const [number, setNumber] = useState(invoice.number ?? "");
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [issueDate, setIssueDate] = useState(invoice.issue_date ?? "");
  const [dueDate, setDueDate] = useState(invoice.due_date ?? "");
  const [taxRate, setTaxRate] = useState(String(invoice.tax_rate ?? 0));
  const [notes, setNotes] = useState(invoice.notes ?? "");
  const [terms, setTerms] = useState(invoice.terms ?? "");
  const [items, setItems] = useState<ItemState[]>(() => {
    const initial = (invoice.items ?? []).map((it) => ({
      key: newKey(),
      description: it.description ?? "",
      quantity: it.quantity?.toString() ?? "",
      unit: it.unit ?? "sqft",
      rate: it.rate?.toString() ?? "",
    }));
    return initial.length ? initial : [emptyItem()];
  });

  const updateItem = (i: number, patch: Partial<ItemState>) =>
    setItems((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, j) => j !== i));

  const totals = invoiceTotals(
    items.map((it) => ({ quantity: it.quantity, rate: it.rate })),
    taxRate,
    amountPaid,
  );

  const save = () =>
    startTransition(async () => {
      const input: SaveInvoiceInput = {
        number,
        status,
        issue_date: issueDate || null,
        due_date: dueDate || null,
        tax_rate: taxRate,
        notes,
        terms,
        items: items.map((it) => ({
          description: it.description,
          quantity: it.quantity || null,
          unit: it.unit,
          rate: it.rate || null,
        })),
      };
      const res = await saveInvoice(invoice.id, input);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Invoice saved");
      router.refresh();
    });

  return (
    <div className="pb-24">
      <Card className="mb-6">
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="number">Invoice #</Label>
            <Input
              id="number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <SegmentedField
              value={status}
              onChange={(v) => setStatus(v as InvoiceStatus)}
              options={INVOICE_STATUS_ORDER.map((s) => ({
                value: s,
                label: INVOICE_STATUS_LABELS[s],
              }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax">Tax rate %</Label>
            <Input
              id="tax"
              type="number"
              step="0.01"
              min="0"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="issue">Issue date</Label>
            <Input
              id="issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="due">Due date</Label>
            <Input
              id="due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((it, i) => (
            <div key={it.key} className="rounded-md border p-3">
              <Input
                value={it.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder="Description"
              />
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Qty
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={it.quantity}
                    onChange={(e) => updateItem(i, { quantity: e.target.value })}
                    className={cn(inputSm, "w-24")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Unit
                  </label>
                  <input
                    value={it.unit}
                    onChange={(e) => updateItem(i, { unit: e.target.value })}
                    className={cn(inputSm, "w-20")}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Rate
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={it.rate}
                      onChange={(e) => updateItem(i, { rate: e.target.value })}
                      className={cn(inputSm, "w-28 pl-5")}
                    />
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-xs text-muted-foreground">Amount</div>
                  <div className="font-semibold">
                    {formatMoney(
                      itemAmount({ quantity: it.quantity, rate: it.rate }),
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove item"
                  onClick={() => removeItem(i)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <Plus className="size-3.5" /> Add item
          </Button>

          <div className="ml-auto w-full max-w-xs space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tax ({taxRate || 0}%)</span>
              <span>{formatMoney(totals.tax)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span>{formatMoney(totals.total)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Paid</span>
              <span>{formatMoney(totals.paid)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <span>Balance due</span>
              <span>{formatMoney(totals.balance)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (shown to customer)</Label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="terms">Payment terms</Label>
            <textarea
              id="terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={3}
              placeholder="e.g. Due on receipt. Pay by card, check, or financing."
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-3 backdrop-blur md:pl-64">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-1">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer className="size-4" /> Print
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            <Save className="size-4" /> {isPending ? "Saving…" : "Save invoice"}
          </Button>
        </div>
      </div>
    </div>
  );
}

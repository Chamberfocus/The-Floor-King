"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Printer, Sparkles } from "lucide-react";
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
  ESTIMATE_PRESENTATION_LABELS,
  type Invoice,
  type InvoiceStatus,
  type EstimatePresentation,
  type Customer,
  type OrgSettings,
} from "@/lib/types";
import { formatDate } from "@/lib/format";
import { saveInvoice } from "./actions";
import { writeScopeDescription } from "@/app/(app)/estimates/ai-actions";

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
  customer,
  org,
}: {
  invoice: Invoice;
  amountPaid: number;
  customer: Customer | null;
  org: OrgSettings;
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
  const [presentation, setPresentation] = useState<EstimatePresentation>(
    invoice.presentation ?? "detailed",
  );
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

  const [aiBusy, setAiBusy] = useState(false);
  const aiDescribe = async () => {
    const lines = items
      .filter((it) => it.description.trim())
      .map((it) => ({
        description: it.description,
        quantity: Number(it.quantity) || null,
        unit: it.unit,
      }));
    if (!lines.length) {
      toast.error("Add line items first.");
      return;
    }
    setAiBusy(true);
    const res = await writeScopeDescription({ kind: "invoice", lines });
    setAiBusy(false);
    if (res.error) toast.error(res.error);
    else {
      setNotes(res.text.trim());
      toast.success("Description written — review & edit as needed");
    }
  };

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

  const buildInput = (): SaveInvoiceInput => ({
    number,
    status,
    presentation,
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
  });

  const save = () =>
    startTransition(async () => {
      const res = await saveInvoice(invoice.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Invoice saved");
      router.refresh();
    });

  // Save first so the record matches the printout, then open the print dialog.
  const saveThenPrint = () =>
    startTransition(async () => {
      const res = await saveInvoice(invoice.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      window.print();
    });

  return (
    <>
    <InvoicePrintDoc
      org={org}
      customer={customer}
      number={number}
      issueDate={issueDate}
      dueDate={dueDate}
      presentation={presentation}
      notes={notes}
      terms={terms}
      items={items}
      totals={totals}
    />
    <div className="pb-24 print:hidden">
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
          <div className="space-y-2 sm:col-span-2">
            <Label>Customer sees</Label>
            <SegmentedField
              value={presentation}
              onChange={(v) => setPresentation(v as EstimatePresentation)}
              options={(Object.keys(ESTIMATE_PRESENTATION_LABELS) as EstimatePresentation[]).map(
                (p) => ({ value: p, label: ESTIMATE_PRESENTATION_LABELS[p] }),
              )}
            />
            <p className="text-[11px] text-muted-foreground">
              Lump sum prints one total (a “ball of wax”); Itemized prints the
              lines. You always keep the line items for your records.
            </p>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="notes">Notes (shown to customer)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={aiDescribe}
                disabled={aiBusy}
              >
                <Sparkles className="size-3.5" /> {aiBusy ? "Writing…" : "AI describe"}
              </Button>
            </div>
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
            disabled={isPending}
            onClick={saveThenPrint}
          >
            <Printer className="size-4" /> Save &amp; print
          </Button>
          <Button type="button" disabled={isPending} onClick={save}>
            <Save className="size-4" /> {isPending ? "Saving…" : "Save invoice"}
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}

/** Clean, print-only invoice document (itemized or lump sum). Save before
 * printing so it reflects the latest edits. */
function InvoicePrintDoc({
  org,
  customer,
  number,
  issueDate,
  dueDate,
  presentation,
  notes,
  terms,
  items,
  totals,
}: {
  org: OrgSettings;
  customer: Customer | null;
  number: string;
  issueDate: string;
  dueDate: string;
  presentation: EstimatePresentation;
  notes: string;
  terms: string;
  items: ItemState[];
  totals: { subtotal: number; tax: number; total: number; paid: number; balance: number };
}) {
  const addr = customer
    ? [customer.street, [customer.city, customer.state].filter(Boolean).join(", "), customer.zip]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <div className="hidden text-black print:block">
      <div className="flex items-start justify-between gap-6 border-b pb-4">
        <div>
          <div className="text-xl font-bold">{org.company_name}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold">INVOICE</div>
          {number ? <div className="text-sm">{number}</div> : null}
          {issueDate ? <div className="text-xs">Issued {formatDate(issueDate)}</div> : null}
          {dueDate ? <div className="text-xs">Due {formatDate(dueDate)}</div> : null}
        </div>
      </div>

      {customer ? (
        <div className="py-4 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Bill to</div>
          <div className="font-medium">{customer.full_name}</div>
          {addr ? <div className="text-xs text-gray-600">{addr}</div> : null}
        </div>
      ) : null}

      {presentation === "summary" ? (
        <div className="py-2 text-sm">
          {notes ? (
            <p className="mb-4 whitespace-pre-wrap">{notes}</p>
          ) : (
            <p className="mb-4">Complete flooring project as quoted.</p>
          )}
        </div>
      ) : (
        <table className="w-full border-collapse py-2 text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="py-1 pr-2 font-medium">Description</th>
              <th className="py-1 px-2 text-right font-medium">Qty</th>
              <th className="py-1 px-2 text-right font-medium">Rate</th>
              <th className="py-1 pl-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items
              .filter((it) => it.description.trim() || it.rate)
              .map((it, i) => (
                <tr key={i} className="border-b align-top">
                  <td className="py-1 pr-2">{it.description}</td>
                  <td className="py-1 px-2 text-right tabular-nums">
                    {it.quantity ? `${it.quantity} ${it.unit}` : ""}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums">
                    {it.rate ? formatMoney(Number(it.rate)) : ""}
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums">
                    {formatMoney(itemAmount({ quantity: it.quantity, rate: it.rate }))}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      <div className="ml-auto mt-3 w-64 text-sm">
        {presentation === "detailed" ? (
          <>
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal</span>
              <span>{formatMoney(totals.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Tax</span>
              <span>{formatMoney(totals.tax)}</span>
            </div>
          </>
        ) : null}
        <div className="flex justify-between border-t pt-1 text-base font-bold">
          <span>Total</span>
          <span>{formatMoney(totals.total)}</span>
        </div>
        {totals.paid > 0 ? (
          <>
            <div className="flex justify-between">
              <span className="text-gray-600">Paid</span>
              <span>{formatMoney(totals.paid)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Balance due</span>
              <span>{formatMoney(totals.balance)}</span>
            </div>
          </>
        ) : null}
      </div>

      {presentation === "detailed" && notes ? (
        <div className="mt-6 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Notes</div>
          <p className="whitespace-pre-wrap">{notes}</p>
        </div>
      ) : null}
      {terms ? (
        <div className="mt-4 text-xs text-gray-600">
          <div className="uppercase tracking-wide text-gray-500">Terms</div>
          <p className="whitespace-pre-wrap">{terms}</p>
        </div>
      ) : null}
    </div>
  );
}

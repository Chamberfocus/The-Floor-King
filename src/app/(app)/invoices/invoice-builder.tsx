"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Save, Printer, Sparkles, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import { cn } from "@/lib/utils";
import { CustomerScopeView } from "@/components/customer-scope-view";
import type { CustomerScope } from "@/lib/customer-scope";
import { formatMoney, docRef } from "@/lib/format";
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
import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
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
  scope,
  narrative,
  preview = false,
}: {
  invoice: Invoice;
  amountPaid: number;
  customer: Customer | null;
  org: OrgSettings;
  preview?: boolean;
  /** Full customer scope from the linked estimate/job (the printed copy shows
   *  this instead of quantities and unit prices). Null when nothing is linked. */
  scope?: CustomerScope | null;
  narrative?: string | null;
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

  const save = (opts: { stash?: boolean } = {}) =>
    startTransition(async () => {
      const res = await saveInvoice(invoice.id, buildInput());
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(opts.stash ? "Saved for later" : "Invoice saved");
      // "Save for later" stashes to /saved; a plain save returns to the
      // customer's dashboard (the job's spine) — only on a successful save.
      if (opts.stash) router.push("/saved");
      else if (invoice.customer_id) router.push(`/customers/${invoice.customer_id}`);
      else router.refresh();
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
      number={number || docRef("INV", invoice.id)}
      issueDate={issueDate}
      dueDate={dueDate}
      presentation={presentation}
      notes={notes}
      terms={terms}
      items={items}
      totals={totals}
      scope={scope ?? null}
      narrative={narrative ?? null}
      preview={preview}
    />
    <div className={cn("pb-44 md:pb-24 print:hidden", preview && "hidden")}>
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
            <p className="text-xs text-muted-foreground">
              Lump sum prints one total (a “ball of wax”); Itemized prints the
              lines. You always keep the line items for your records.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="issue">Issue date</Label>
            <DateField
              id="issue"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="due">Due date</Label>
            <DateField
              id="due"
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

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 p-3 backdrop-blur md:bottom-0 md:pl-64">
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-2 px-1">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={saveThenPrint}
          >
            <Printer className="size-4" /> Save &amp; print
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => save({ stash: true })}
          >
            <Bookmark className="size-4" /> Save for later
          </Button>
          {status === "void" && invoice.status !== "void" ? (
            <ConfirmButton
              disabled={isPending}
              onConfirm={() => save()}
              title="Void this invoice?"
              description="Voiding cancels the invoice and stops its balance from counting. This is hard to reverse."
              confirmLabel="Void invoice"
              destructive
            >
              <Save className="size-4" /> {isPending ? "Saving…" : "Save invoice"}
            </ConfirmButton>
          ) : (
            <Button type="button" disabled={isPending} onClick={() => save()}>
              <Save className="size-4" /> {isPending ? "Saving…" : "Save invoice"}
            </Button>
          )}
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
  scope,
  narrative,
  preview = false,
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
  scope: CustomerScope | null;
  narrative: string | null;
  /** On-screen document preview: show the doc as a white sheet (not print-only). */
  preview?: boolean;
}) {
  // Same rule as the estimate: show the full scope, never a quantity or a unit
  // price. Scope comes from the linked estimate/job; if the invoice isn't linked,
  // fall back to the line DESCRIPTIONS only (qty/rate withheld).
  const fallbackLines = items
    .map((it) => it.description.trim())
    .filter(Boolean);

  return (
    <div
      className={cn(
        "text-black print:block",
        preview
          ? "mx-auto max-w-4xl bg-white p-6 shadow-sm ring-1 ring-black/10 sm:p-10"
          : "hidden",
      )}
    >
      <PrintLetterhead
        org={org}
        docTitle="INVOICE"
        meta={
          <>
            {number ? <div className="text-sm font-medium">{number}</div> : null}
            {issueDate ? <div className="text-xs">Issued {formatDate(issueDate)}</div> : null}
            {dueDate ? <div className="text-xs">Due {formatDate(dueDate)}</div> : null}
          </>
        }
      />

      {customer ? (
        <PrintBillTo
          label="Bill to"
          name={customer.full_name}
          street={customer.street}
          city={customer.city}
          state={customer.state}
          zip={customer.zip}
          phone={customer.phone}
          email={customer.email}
        />
      ) : null}

      <div className="mt-2 border-t pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Work performed
        </div>
        {scope ? (
          <CustomerScopeView
            scope={scope}
            variant={presentation === "summary" ? "condensed" : "full"}
            narrative={narrative}
          />
        ) : fallbackLines.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {fallbackLines.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">Complete flooring project as described.</p>
        )}
        {notes ? <p className="mt-3 whitespace-pre-wrap text-sm">{notes}</p> : null}
      </div>

      <div className="ml-auto mt-4 w-64 break-inside-avoid border-t-2 border-gray-800 pt-2 text-sm">
        <div className="flex justify-between text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(totals.total)}</span>
        </div>
        <div className="text-[10px] text-gray-500">Applicable tax included.</div>
        {totals.paid > 0 ? (
          <div className="mt-1 flex justify-between">
            <span className="text-gray-600">Paid to date</span>
            <span className="tabular-nums">{formatMoney(totals.paid)}</span>
          </div>
        ) : null}
        <div className="mt-1 flex justify-between border-t pt-1 text-base font-bold">
          <span>Balance due</span>
          <span className="tabular-nums">{formatMoney(totals.balance)}</span>
        </div>
      </div>

      <div className="mt-6 break-inside-avoid text-xs text-gray-600">
        <div className="font-semibold uppercase tracking-wide text-gray-500">
          Payment
        </div>
        <p>
          We accept cash, check, and all major credit cards
          {org.financing_url ? ", plus financing" : ""}. Please make checks
          payable to {org.company_name}.
        </p>
        {terms ? <p className="mt-2 whitespace-pre-wrap">{terms}</p> : null}
      </div>
    </div>
  );
}

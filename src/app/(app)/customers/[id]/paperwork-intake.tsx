"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardPaste, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { formatMoney } from "@/lib/format";
import { pdfToText, spreadsheetToText } from "@/lib/pdf-client";
import {
  finishPaperwork,
  matchSupplierId,
  moneyRound,
  parsePaperwork,
  type PaperworkDraft,
  type PaperworkKind,
  type PaperworkLine,
} from "@/lib/paperwork";
import { applyCustomerPaperwork, readPaperworkImage } from "./paperwork-actions";

const KINDS: { value: PaperworkKind; label: string }[] = [
  { value: "order_confirmation", label: "Order confirmation" },
  { value: "vendor_invoice", label: "Vendor invoice" },
  { value: "other", label: "Keep on file" },
];

export function PaperworkIntake({
  customerId,
  customerName,
  suppliers,
  jobs,
  purchaseOrders,
}: {
  customerId: string;
  customerName: string;
  suppliers: { id: string; name: string }[];
  jobs: { id: string; title: string }[];
  purchaseOrders: { id: string; label: string; supplierId: string | null; total: number }[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<PaperworkDraft | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [jobId, setJobId] = useState(jobs.length === 1 ? jobs[0].id : "");
  const [poId, setPoId] = useState("");
  const [placeOrder, setPlaceOrder] = useState(true);
  const [token, setToken] = useState("");
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  const applyDraft = (next: PaperworkDraft) => {
    const supplier = matchSupplierId(next.vendor, suppliers) ?? "";
    setDraft(next);
    setSupplierId(supplier);
    setToken(crypto.randomUUID());
    const sameVendor = purchaseOrders.filter((po) => supplier && po.supplierId === supplier);
    const close = sameVendor.filter((po) => Math.abs(po.total - next.lineTotal) <= 1);
    setPoId(next.kind === "vendor_invoice" && close.length === 1 ? close[0].id : "");
    setPlaceOrder(next.kind === "order_confirmation" && next.balanced && !!supplier);
  };

  const readText = (value: string) => {
    const parsed = parsePaperwork(value, customerName);
    if (!parsed.lines.length && parsed.kind !== "other") {
      toast.error("No line items in that paste. Include the quantities and prices.");
    }
    applyDraft(parsed);
  };

  const onFile = (picked: File | null) => {
    if (!picked) return;
    setFile(picked);
    startReading(async () => {
      const name = picked.name.toLowerCase();
      const image = picked.type.startsWith("image/");
      try {
        if (image) {
          const fd = new FormData();
          fd.set("file", picked);
          const res = await readPaperworkImage(fd);
          if (res.error || !res.draft) {
            toast.error(res.error || "Couldn't read that photo.");
            return;
          }
          applyDraft(res.draft);
          return;
        }
        let body = "";
        if (name.endsWith(".pdf") || picked.type === "application/pdf") {
          body = (await pdfToText(picked)).text;
        } else if (name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
          body = await spreadsheetToText(picked);
        } else {
          body = await picked.text();
        }
        readText(body);
      } catch {
        toast.error("Couldn't read that file. Paste the text from it.");
      }
    });
  };

  const updateLine = (index: number, patch: Partial<PaperworkLine>) => {
    setDraft((current) => {
      if (!current) return current;
      const lines = current.lines.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, ...patch, warning: null };
        if (patch.amount == null && (patch.quantity != null || patch.unitCost != null)) {
          next.amount = moneyRound(next.quantity * next.unitCost);
        }
        if (patch.amount != null && next.quantity) {
          next.unitCost = Math.round((next.amount / next.quantity) * 10000) / 10000;
        }
        return next;
      });
      return finishPaperwork({
        ...current,
        lines,
        warnings: current.warnings.filter((w) => w.startsWith("This paperwork is addressed")),
      });
    });
  };

  const save = () => {
    if (!draft) return;
    startSaving(async () => {
      const fd = new FormData();
      fd.set("customer_id", customerId);
      fd.set("kind", draft.kind);
      fd.set("vendor", draft.vendor);
      fd.set("supplier_id", supplierId);
      fd.set("number", draft.number);
      fd.set("date", draft.date);
      fd.set("due_date", draft.dueDate);
      fd.set("eta", draft.eta);
      fd.set("terms", draft.terms);
      fd.set("job_id", jobId);
      fd.set("po_id", draft.kind === "vendor_invoice" ? poId : "");
      fd.set("place_order", placeOrder ? "1" : "0");
      fd.set("printed_total", draft.printedTotal == null ? "" : String(draft.printedTotal));
      fd.set("lines", JSON.stringify(draft.lines));
      fd.set("idempotency_key", token);
      if (file) fd.set("file", file);
      const res = await applyCustomerPaperwork(fd);
      if (res.error) {
        toast.error(res.error);
        if (res.href) router.push(res.href);
        return;
      }
      toast.success(
        draft.kind === "vendor_invoice"
          ? poId
            ? "Invoice added. It replaces that purchase order in the job cost."
            : "Invoice added and counted on the job."
          : draft.kind === "order_confirmation"
            ? placeOrder
              ? "Order added and counted on the job."
              : "Order saved as a draft."
            : "Paperwork saved on the customer.",
      );
      if (res.href) router.push(res.href);
      router.refresh();
    });
  };

  const moneyBlocked =
    !!draft &&
    draft.kind !== "other" &&
    (draft.lines.length === 0 || (draft.printedTotal != null && !draft.balanced));
  const vendorBlocked =
    !!draft &&
    ((draft.kind === "vendor_invoice" && !supplierId) ||
      (draft.kind === "order_confirmation" && placeOrder && !supplierId));

  return (
    <Card className="mb-4">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Supplier paperwork</CardTitle>
        <p className="text-sm text-muted-foreground">
          Paste or upload the order confirmation or the vendor invoice. The lines have to
          add up to the printed total before they go on this customer.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!draft ? (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder={"Shaw Industries\nOrder Confirmation\nOrder number: 451239\nAnso Color Wall  120  SY  12.50  1,500.00\nTotal  1,500.00"}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={!text.trim() || reading} onClick={() => readText(text)}>
                <ClipboardPaste className="size-4" /> Read paperwork
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={reading}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp className="size-4" /> {reading ? "Reading…" : "Upload"}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*,.csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  onFile(picked);
                }}
              />
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, kind: item.value })}
                  className={
                    draft.kind === item.value
                      ? "rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
                      : "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Vendor</Label>
                <SearchPicker
                  value={supplierId}
                  onChange={setSupplierId}
                  placeholder={draft.vendor || "Choose the vendor"}
                  options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Document number</Label>
                <Input
                  value={draft.number}
                  onChange={(e) => setDraft({ ...draft, number: e.target.value })}
                />
              </div>
              {jobs.length > 1 ? (
                <div className="space-y-1 sm:col-span-2">
                  <Label>Job</Label>
                  <SearchPicker
                    value={jobId}
                    onChange={setJobId}
                    placeholder="Choose the job"
                    options={jobs.map((j) => ({ value: j.id, label: j.title }))}
                  />
                </div>
              ) : null}
              {draft.kind === "vendor_invoice" && purchaseOrders.length ? (
                <div className="space-y-1 sm:col-span-2">
                  <Label>Replaces this purchase order</Label>
                  <SearchPicker
                    value={poId}
                    onChange={setPoId}
                    allowClear
                    placeholder="No purchase order yet"
                    options={purchaseOrders.map((po) => ({
                      value: po.id,
                      label: po.label,
                      hint: formatMoney(po.total),
                    }))}
                  />
                  {poId ? (
                    <p className="text-xs text-muted-foreground">
                      The invoice becomes the cost. The purchase order is not counted again.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              {draft.lines.map((line, i) => (
                <div key={`${line.description}-${i}`} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-5">
                  <Input
                    value={line.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    className="col-span-2 sm:col-span-1"
                    aria-label="Description"
                  />
                  <Input
                    type="number"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
                    aria-label="Quantity"
                  />
                  <Input
                    value={line.unit}
                    onChange={(e) => updateLine(i, { unit: e.target.value })}
                    aria-label="Unit"
                  />
                  <Input
                    type="number"
                    value={line.unitCost}
                    onChange={(e) => updateLine(i, { unitCost: Number(e.target.value) })}
                    aria-label="Unit cost"
                  />
                  <Input
                    type="number"
                    value={line.amount}
                    onChange={(e) => updateLine(i, { amount: Number(e.target.value) })}
                    aria-label="Amount"
                  />
                </div>
              ))}
            </div>

            <div
              className={
                draft.kind !== "other" && draft.printedTotal != null && !draft.balanced
                  ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                  : "rounded-md border bg-muted/40 px-3 py-2 text-sm"
              }
            >
              Lines {formatMoney(draft.lineTotal)}
              {draft.printedTotal != null
                ? ` · Document total ${formatMoney(draft.printedTotal)}`
                : ""}
              {draft.printedTotal != null
                ? draft.balanced
                  ? " · Totals match"
                  : ` · Off by ${formatMoney(Math.abs(draft.difference))}`
                : ""}
            </div>
            {draft.warnings.length ? (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {draft.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {draft.kind === "order_confirmation" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={placeOrder}
                  onChange={(e) => setPlaceOrder(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                This order is already placed and counts on the job
              </label>
            ) : null}
            {jobs.length === 0 && draft.kind !== "other" ? (
              <p className="text-sm text-muted-foreground">
                This stays on the customer. It counts on a job after a job is on the file.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={saving || moneyBlocked || vendorBlocked} onClick={save}>
                {saving
                  ? "Saving…"
                  : draft.kind === "vendor_invoice"
                    ? "Add invoice"
                    : draft.kind === "order_confirmation"
                      ? "Add order"
                      : "Save on file"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraft(null);
                  setFile(null);
                }}
              >
                Start over
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Trash2, Plus, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { extractBillFromUpload, createBillFromImport } from "./actions";

interface Item {
  description: string;
  quantity: number | null;
  unit: string;
  unit_cost: number | null;
}
interface Draft {
  vendor: string;
  bill_number: string;
  bill_date: string;
  due_date: string;
  terms: string;
  memo: string;
  items: Item[];
}

const TERMS = [
  { value: "due_on_receipt", label: "Due on receipt" },
  { value: "net_15", label: "Net 15" },
  { value: "net_30", label: "Net 30" },
  { value: "net_45", label: "Net 45" },
  { value: "net_60", label: "Net 60" },
];
function normalizeTerms(t: string | null): string {
  const s = (t ?? "").toLowerCase();
  if (/receipt|cod|due now/.test(s)) return "due_on_receipt";
  const m = s.match(/net\s*(\d+)|(\d+)\s*days?/);
  const n = m ? parseInt(m[1] || m[2], 10) : null;
  if (n && [15, 30, 45, 60].includes(n)) return `net_${n}`;
  return "net_30";
}
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

export function BillImporter() {
  const router = useRouter();
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [extractedTotal, setExtractedTotal] = useState<number | null>(null);

  const onFile = (file: File | null) => {
    if (!file) return;
    startReading(async () => {
      try {
        setStatus("Uploading…");
        const supabase = createClient();
        const path = `bills/${crypto.randomUUID()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("documents")
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) {
          toast.error(`Upload failed: ${upErr.message}`);
          setStatus(null);
          return;
        }
        setStatus("Reading the bill with AI…");
        const res = await extractBillFromUpload(path, file.type || "");
        if (res.error || !res.bill) {
          toast.error(res.error || "Couldn't read that bill.");
          setStatus(null);
          return;
        }
        const b = res.bill;
        const items: Item[] = (b.items ?? []).map((it) => ({
          description: it.description || "",
          quantity: it.quantity ?? (it.unit_cost == null && it.amount != null ? 1 : null),
          unit: it.unit || "ea",
          unit_cost: it.unit_cost ?? it.amount ?? null,
        }));
        if (b.freight)
          items.push({ description: "Freight / shipping", quantity: 1, unit: "ea", unit_cost: b.freight });
        if (b.tax) items.push({ description: "Sales tax", quantity: 1, unit: "ea", unit_cost: b.tax });
        setDraft({
          vendor: b.vendor ?? "",
          bill_number: b.bill_number ?? "",
          bill_date: b.bill_date ?? "",
          due_date: b.due_date ?? "",
          terms: normalizeTerms(b.terms),
          memo: "",
          items: items.length ? items : [{ description: "", quantity: null, unit: "ea", unit_cost: null }],
        });
        setExtractedTotal(b.total);
        setStatus(null);
        toast.success("Read the bill — review the details, then create it.");
      } catch (e) {
        setStatus(null);
        toast.error(e instanceof Error ? e.message : "Couldn't read that bill.");
      }
    });
  };

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setItem = (i: number, p: Partial<Item>) =>
    setDraft((d) =>
      d ? { ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...p } : it)) } : d,
    );
  const addItem = () =>
    setDraft((d) =>
      d ? { ...d, items: [...d.items, { description: "", quantity: null, unit: "ea", unit_cost: null }] } : d,
    );
  const removeItem = (i: number) =>
    setDraft((d) => (d ? { ...d, items: d.items.filter((_, j) => j !== i) } : d));

  const total = draft ? draft.items.reduce((s, it) => s + num(it.quantity) * num(it.unit_cost), 0) : 0;
  const mismatch =
    extractedTotal != null && Math.abs(total - extractedTotal) > 0.01 ? extractedTotal : null;

  const save = () => {
    if (!draft) return;
    startSaving(async () => {
      const res = await createBillFromImport(draft);
      if (res.ok && res.billId) {
        toast.success("Bill created.");
        router.push(`/bills/${res.billId}`);
      } else {
        toast.error(res.error || "Couldn't create the bill.");
      }
    });
  };

  if (!draft) {
    return (
      <Card>
        <CardContent className="p-6">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/40",
              reading && "pointer-events-none opacity-70",
            )}
          >
            <FileUp className="size-8 text-muted-foreground" />
            <div className="text-sm font-medium">
              {reading ? status ?? "Working…" : "Drop a vendor bill (PDF or photo), or click to choose"}
            </div>
            <div className="text-xs text-muted-foreground">
              We read the vendor, dates, terms, and every line — you confirm before it saves.
            </div>
            <input
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              disabled={reading}
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm text-primary">
        <Sparkles className="size-4" /> Read from your bill — check everything, fix
        anything, then create.
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => {
            setDraft(null);
            setExtractedTotal(null);
          }}
        >
          <RotateCcw className="size-3.5" /> Start over
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="text-xs text-muted-foreground">
            Vendor
            <Input value={draft.vendor} onChange={(e) => patch({ vendor: e.target.value })} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">
            Vendor bill #
            <Input value={draft.bill_number} onChange={(e) => patch({ bill_number: e.target.value })} className="mt-1" />
          </label>
          <label className="text-xs text-muted-foreground">
            Bill date
            <DateField
              name="bill_date"
              defaultValue={draft.bill_date}
              onChange={(e) => patch({ bill_date: (e.target as HTMLInputElement).value })}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Terms
            <select
              value={draft.terms}
              onChange={(e) => patch({ terms: e.target.value })}
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
            Due date <span className="opacity-60">(blank = from terms)</span>
            <DateField
              name="due_date"
              defaultValue={draft.due_date}
              onChange={(e) => patch({ due_date: (e.target as HTMLInputElement).value })}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Memo
            <Input value={draft.memo} onChange={(e) => patch({ memo: e.target.value })} className="mt-1" />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Description</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-left">Unit</th>
                  <th className="px-2 py-2 text-right">Unit cost</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {draft.items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <Input
                        value={it.description}
                        onChange={(e) => setItem(i, { description: e.target.value })}
                        className="h-8 min-w-40"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={it.quantity ?? ""}
                        onChange={(e) => setItem(i, { quantity: e.target.value ? Number(e.target.value) : null })}
                        className="h-8 w-20 text-right"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        value={it.unit}
                        onChange={(e) => setItem(i, { unit: e.target.value })}
                        className="h-8 w-16"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        type="number"
                        step="0.01"
                        value={it.unit_cost ?? ""}
                        onChange={(e) => setItem(i, { unit_cost: e.target.value ? Number(e.target.value) : null })}
                        className="h-8 w-24 text-right"
                      />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {formatMoney(num(it.quantity) * num(it.unit_cost))}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeItem(i)} aria-label="Remove line">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t p-3">
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="size-3.5" /> Add line
            </Button>
            <div className="text-right">
              <div className="text-lg font-bold tabular-nums">{formatMoney(total)}</div>
              {mismatch != null ? (
                <div className="text-xs font-medium text-destructive">
                  Bill says {formatMoney(mismatch)} — check the lines
                </div>
              ) : extractedTotal != null ? (
                <div className="text-xs text-emerald-600">✓ Matches the bill total</div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Creating…" : "Create bill"}
        </Button>
      </div>
    </div>
  );
}

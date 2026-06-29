"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Check, CalendarClock, Package } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { SampleCheckout, Product } from "@/lib/types";
import { ProductPicker } from "@/app/(app)/estimates/product-picker";
import {
  checkoutSamples,
  returnCheckout,
  returnSampleItem,
  extendCheckout,
  markCheckoutLost,
  deleteCheckout,
} from "./sample-actions";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const todayPlus = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
};
/** Whole days from today to the due date (negative = overdue). */
function daysLeft(due: string): number {
  const a = new Date(new Date().toDateString()).getTime(); // today, local midnight
  const b = new Date(`${due}T00:00:00`).getTime(); // due, local midnight
  return Math.round((b - a) / 86400000);
}

interface DraftItem {
  key: string;
  label: string;
  productId: string | null;
  qty: string;
}
let dk = 0;

export function SamplesCard({
  customerId,
  checkouts,
  loanDays,
  defaultDeposit = 0,
  maxOut = 0,
}: {
  customerId: string;
  checkouts: SampleCheckout[];
  loanDays: number;
  defaultDeposit?: number;
  maxOut?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [due, setDue] = useState(todayPlus(loanDays));
  const [deposit, setDeposit] = useState(defaultDeposit ? String(defaultDeposit) : "");
  const [resetKey, setResetKey] = useState(0);

  const active = checkouts.filter((c) => c.status === "out");
  const history = checkouts.filter((c) => c.status !== "out");
  // How many samples this customer currently has out (for the limit).
  const currentOut = active.reduce(
    (s, c) => s + c.items.reduce((t, i) => t + (Number(i.qty) || 0), 0),
    0,
  );
  const addingQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const overLimit = maxOut > 0 && currentOut + addingQty > maxOut;

  const run = (fn: () => Promise<{ error: string | null }>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else router.refresh();
    });

  const addFromCatalog = (p: Product) => {
    const label =
      [p.manufacturer, p.name, p.color].filter(Boolean).join(" ") || p.name;
    setItems((xs) => [...xs, { key: `d${dk++}`, label, productId: p.id, qty: "1" }]);
    setResetKey((k) => k + 1);
  };
  const addCustom = () =>
    setItems((xs) => [...xs, { key: `d${dk++}`, label: "", productId: null, qty: "1" }]);
  const setItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const submit = () =>
    start(async () => {
      const payload = items
        .filter((i) => i.label.trim())
        .map((i) => ({ label: i.label.trim(), productId: i.productId, qty: Number(i.qty) || 1 }));
      if (!payload.length) {
        toast.error("Add at least one sample.");
        return;
      }
      if (overLimit) {
        toast.error(
          `Limit is ${maxOut} samples out — they already have ${currentOut}.`,
        );
        return;
      }
      const res = await checkoutSamples({
        customerId,
        items: payload,
        dueDate: due,
        deposit: Number(deposit) > 0 ? Number(deposit) : null,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Samples checked out — customer notified");
      setItems([]);
      setDue(todayPlus(loanDays));
      setDeposit(defaultDeposit ? String(defaultDeposit) : "");
      setOpen(false);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          Samples
          {currentOut
            ? ` · ${currentOut}${maxOut ? `/${maxOut}` : ""} out`
            : maxOut
              ? ` · limit ${maxOut}`
              : ""}
        </CardTitle>
        <Button type="button" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plus className="size-3.5" /> Check out samples
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Checkout form */}
        {open ? (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
            <ProductPicker
              key={resetKey}
              value=""
              label="Add a sample from the catalog"
              onPick={(p) => p && addFromCatalog(p)}
              onCreated={(p) => addFromCatalog(p)}
            />
            <button
              type="button"
              onClick={addCustom}
              className="text-xs font-medium text-primary hover:underline"
            >
              + add a sample by hand
            </button>

            {items.length ? (
              <div className="space-y-1.5">
                {items.map((it) => (
                  <div key={it.key} className="flex items-center gap-1.5">
                    <Input
                      value={it.label}
                      onChange={(e) => setItem(it.key, { label: e.target.value })}
                      placeholder="Sample (brand / style / color)"
                      className="h-8 flex-1"
                    />
                    <Input
                      value={it.qty}
                      onChange={(e) => setItem(it.key, { qty: e.target.value })}
                      inputMode="numeric"
                      className="h-8 w-14"
                      aria-label="Quantity"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove"
                      onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
                    >
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pick samples from the catalog or add them by hand.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Return by</label>
                <input
                  type="date"
                  value={due}
                  min={todayPlus(0)}
                  onChange={(e) => setDue(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Deposit / hold</label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">$</span>
                  <Input
                    value={deposit}
                    onChange={(e) => setDeposit(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="h-9 w-24"
                  />
                </div>
              </div>
              <Button type="button" onClick={submit} disabled={pending || overLimit}>
                {pending ? "Saving…" : "Check out & notify"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            {overLimit ? (
              <p className="text-xs font-medium text-destructive">
                Over the limit — {currentOut + addingQty} would be out, max is{" "}
                {maxOut}. Return some first or raise the limit in Settings → Samples.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Active checkouts */}
        {active.length === 0 && !open ? (
          <p className="text-sm text-muted-foreground">
            No samples out. Click <strong>Check out samples</strong> when this
            customer takes some home — they&apos;ll get a return reminder by text
            &amp; email.
          </p>
        ) : null}

        {active.map((c) => {
          const dl = daysLeft(c.due_date);
          const overdue = dl < 0;
          return (
            <div key={c.id} className="rounded-lg border p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    overdue
                      ? "bg-destructive/10 text-destructive"
                      : dl <= 2
                        ? "bg-amber-500/10 text-amber-700"
                        : "bg-emerald-500/10 text-emerald-700",
                  )}
                >
                  <CalendarClock className="size-3" />
                  {overdue
                    ? `${Math.abs(dl)} day${Math.abs(dl) === 1 ? "" : "s"} overdue`
                    : dl === 0
                      ? "Due today"
                      : `${dl} day${dl === 1 ? "" : "s"} left`}{" "}
                  · due {formatDate(c.due_date)}
                </span>
                <div className="flex items-center gap-1">
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => returnCheckout(c.id))}>
                    <Check className="size-3.5" /> Returned
                  </Button>
                  <ExtendButton checkoutId={c.id} current={c.due_date} loanDays={loanDays} disabled={pending} onDone={() => router.refresh()} />
                  <Button type="button" size="sm" variant="ghost" disabled={pending} title="Mark lost" onClick={() => { if (confirm("Mark these samples as lost?")) run(() => markCheckoutLost(c.id)); }}>
                    Lost
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Delete" disabled={pending} onClick={() => { if (confirm("Delete this checkout record?")) run(() => deleteCheckout(c.id)); }}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
              <ul className="space-y-1 text-sm">
                {c.items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-2">
                    <span className={cn("flex items-center gap-1.5", it.returned && "text-muted-foreground line-through")}>
                      <Package className="size-3.5 text-muted-foreground" />
                      {it.qty > 1 ? `${it.qty}× ` : ""}{it.label}
                    </span>
                    {!it.returned ? (
                      <button type="button" disabled={pending} onClick={() => run(() => returnSampleItem(it.id))} className="text-xs font-medium text-primary hover:underline">
                        mark returned
                      </button>
                    ) : (
                      <span className="text-xs text-emerald-600">returned</span>
                    )}
                  </li>
                ))}
              </ul>
              {c.deposit || c.notes ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {c.deposit ? <span className="font-medium text-foreground">${c.deposit} hold</span> : null}
                  {c.deposit && c.notes ? " · " : ""}
                  {c.notes ?? ""}
                </p>
              ) : null}
            </div>
          );
        })}

        {/* History */}
        {history.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Past checkouts ({history.length})
            </summary>
            <ul className="mt-2 space-y-1.5">
              {history.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">
                    {c.items.map((i) => i.label).join(", ")}
                  </span>
                  <span className="shrink-0">
                    {c.status === "lost" ? "Lost" : `Returned ${c.returned_at ? formatDate(c.returned_at) : ""}`}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ExtendButton({
  checkoutId,
  current,
  loanDays,
  disabled,
  onDone,
}: {
  checkoutId: string;
  current: string;
  loanDays: number;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current);
  const [pending, start] = useTransition();
  if (!editing) {
    return (
      <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { setVal(todayPlus(loanDays)); setEditing(true); }}>
        Extend
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="date"
        value={val}
        min={todayPlus(0)}
        onChange={(e) => setVal(e.target.value)}
        className="h-8 rounded-md border border-input bg-transparent px-1.5 text-xs"
      />
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await extendCheckout(checkoutId, val);
            if (res.error) toast.error(res.error);
            else {
              toast.success("Due date updated");
              setEditing(false);
              onDone();
            }
          })
        }
      >
        Save
      </Button>
    </span>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Plus, Trash2, UserPlus, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductPicker } from "@/app/(app)/estimates/product-picker";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ringUpCounterSale, findWalkIn, type CounterSaleLine } from "./actions";
import type { Product } from "@/lib/types";

const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const METHODS = ["cash", "card", "check", "zelle"] as const;

type Row = CounterSaleLine & { key: string };
const newRow = (): Row => ({
  key: Math.random().toString(36).slice(2),
  description: "",
  quantity: 1,
  unit: "each",
  rate: 0,
  productId: null,
});

/**
 * Ring up a walk-in: who they are, what they took, what they paid.
 *
 * Deliberately one screen. A counter sale competes with a queue at the desk —
 * anything that makes it slower than writing on a pad gets abandoned, and then
 * the sale never reaches the books at all.
 */
export function CounterSaleForm({
  defaultTaxRate,
  targetMarginPct,
}: {
  defaultTaxRate: number;
  targetMarginPct: number;
}) {
  /** Cost → shelf price at the shop's target margin. price = cost / (1 - m). */
  const retail = (cost: number) => {
    const m = targetMarginPct / 100;
    if (!(cost > 0) || !(m >= 0 && m < 1)) return cost;
    return Math.round((cost / (1 - m)) * 100) / 100;
  };
  const router = useRouter();
  const [pending, start] = useTransition();

  // Who
  const [q, setQ] = useState("");
  const [found, setFound] = useState<
    { id: string; name: string; phone: string | null; city: string | null }[]
  >([]);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const [nc, setNc] = useState({
    fullName: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    state: "",
    zip: "",
  });
  const [optIn, setOptIn] = useState(true);

  // What
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [taxRate, setTaxRate] = useState(String(defaultTaxRate ?? 0));

  // Money
  const [method, setMethod] = useState<string>("cash");
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (existing || !q.trim()) {
      setFound([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const rs = await findWalkIn(q);
      if (active) setFound(rs);
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, existing]);

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((p) => p.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const pick = (key: string, p: Product | null) => {
    if (!p) return;
    setRow(key, {
      description: [p.manufacturer, p.name, p.color].filter(Boolean).join(" ").trim(),
      unit: p.unit || "each",
      // The catalog rate is OUR COST. Selling at it would hand the material
      // over at cost, so mark it up to the shop's target margin — the same
      // number the public order form quotes, so a walk-in and an online order
      // never see two different prices for the same product.
      rate: retail(Number(p.material_rate ?? 0)),
      productId: p.id,
    });
  };

  const subtotal = rows.reduce((s, r) => s + r.quantity * r.rate, 0);
  const tax = subtotal * (num(taxRate) / 100);
  const total = subtotal + tax;

  const save = () =>
    start(async () => {
      const res = await ringUpCounterSale({
        customerId: existing?.id ?? null,
        newCustomer: existing ? null : nc,
        marketingOptIn: optIn,
        lines: rows
          .filter((r) => r.description.trim() && r.quantity > 0)
          .map(({ key: _k, ...l }) => l),
        taxRatePct: num(taxRate),
        payment: { method, amount: total, reference },
      });
      if (res.error || !res.invoiceId) {
        toast.error(res.error ?? "Couldn't complete the sale.");
        return;
      }
      toast.success("Sale recorded");
      router.push(`/invoices/${res.invoiceId}?print=1`);
    });

  const canSave =
    (existing || nc.fullName.trim()) &&
    rows.some((r) => r.description.trim() && r.quantity > 0 && r.rate > 0);

  return (
    <div className="space-y-4">
      {/* 1 · Who ------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who&apos;s buying</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {existing ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-semibold">{existing.name}</span>
              <button
                type="button"
                onClick={() => setExisting(null)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Been in before? Search name, phone or email…"
                  className="pl-8"
                />
              </div>
              {found.length ? (
                <div className="divide-y rounded-md border">
                  {found.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setExisting({ id: c.id, name: c.name })}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[c.phone, c.city].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="rounded-md border p-3">
                <div className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium">
                  <UserPlus className="size-4" /> New customer
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={nc.fullName}
                    onChange={(e) => setNc({ ...nc, fullName: e.target.value })}
                    placeholder="Full name *"
                  />
                  <Input
                    value={nc.phone}
                    onChange={(e) => setNc({ ...nc, phone: e.target.value })}
                    placeholder="Phone"
                    inputMode="tel"
                  />
                  <Input
                    value={nc.email}
                    onChange={(e) => setNc({ ...nc, email: e.target.value })}
                    placeholder="Email"
                    inputMode="email"
                    className="sm:col-span-2"
                  />
                  <Input
                    value={nc.street}
                    onChange={(e) => setNc({ ...nc, street: e.target.value })}
                    placeholder="Street"
                    className="sm:col-span-2"
                  />
                  <Input
                    value={nc.city}
                    onChange={(e) => setNc({ ...nc, city: e.target.value })}
                    placeholder="City"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={nc.state}
                      onChange={(e) => setNc({ ...nc, state: e.target.value })}
                      placeholder="State"
                    />
                    <Input
                      value={nc.zip}
                      onChange={(e) => setNc({ ...nc, zip: e.target.value })}
                      placeholder="ZIP"
                      inputMode="numeric"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* The reason for taking their details at all. Explicit, and dated
              when it's saved — consent you can't date is consent you can't use. */}
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-primary/30 bg-primary/5 p-3">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={optIn}
              onChange={(e) => setOptIn(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-medium">Sign up for deals at The Floor King</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Ask them first. Saves their consent with today&apos;s date.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      {/* 2 · What ----------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What they&apos;re taking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map((r) => (
            <div key={r.key} className="rounded-lg border p-3">
              <ProductPicker
                value={r.productId ?? ""}
                initialLabel={r.description}
                label="Product"
                fullWidth
                onPick={(p) => pick(r.key, p)}
                onCreated={(p) => pick(r.key, p)}
                onUseOnce={(input) =>
                  setRow(r.key, {
                    description: input.name,
                    unit: input.unit || "each",
                    rate: Number(input.material_rate) || 0,
                    productId: null,
                  })
                }
              />
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                <Input
                  value={r.description}
                  onChange={(e) => setRow(r.key, { description: e.target.value })}
                  placeholder="Description"
                  className="sm:col-span-2"
                />
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">
                    Qty ({r.unit})
                  </Label>
                  <Input
                    value={String(r.quantity)}
                    onChange={(e) => setRow(r.key, { quantity: num(e.target.value) })}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">
                    Price / {r.unit}
                  </Label>
                  <Input
                    value={String(r.rate)}
                    onChange={(e) => setRow(r.key, { rate: num(e.target.value) })}
                    inputMode="decimal"
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm font-semibold tabular-nums">
                  {formatMoney(r.quantity * r.rate)}
                </span>
                {rows.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((p) => [...p, newRow()])}
          >
            <Plus className="size-3.5" /> Another product
          </Button>
        </CardContent>
      </Card>

      {/* 3 · Money ---------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Payment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm font-medium capitalize",
                  method === m
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {m}
              </button>
            ))}
          </div>
          {method !== "cash" ? (
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={method === "check" ? "Check number" : "Reference / last 4"}
            />
          ) : null}
          <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
            <Label className="self-center text-sm">Tax %</Label>
            <Input
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tax</span>
              <span className="tabular-nums">{formatMoney(tax)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>
          <Button
            type="button"
            size="lg"
            className="w-full"
            disabled={!canSave || pending}
            onClick={save}
          >
            <Receipt className="size-4" />
            {pending ? "Recording…" : `Take ${formatMoney(total)} & print the receipt`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Records a paid invoice against the customer and opens the receipt to print.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, UserPlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { SearchPicker } from "@/components/ui/search-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import {
  QuickLines,
  emptyQuickLine,
  lineTotal,
  type QuickLineState,
  type QuickProduct,
} from "@/components/quick-lines";
import { createQuickEstimate } from "./actions";
import { CustomerMatchPanel } from "@/components/customer-match-panel";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";
import { marginPct, num as parseMoney } from "@/lib/estimate-calc";
import { landedMaterialCost } from "@/lib/freight";

const num = (v: string) => parseMoney(v);

export function QuickEstimateForm({
  customers,
  products,
  defaultTaxRate,
  targetMargin,
  freightMarkupPct = 0,
  presetCustomerId,
}: {
  customers: { id: string; full_name: string }[];
  products: (QuickProduct & { cost?: number | null })[];
  defaultTaxRate: number;
  targetMargin: number;
  /** Org freight & fees % — applied to catalog material cost for margin. */
  freightMarkupPct?: number;
  presetCustomerId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"existing" | "new">(
    presetCustomerId ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState(presetCustomerId ?? "");
  const [nc, setNc] = useState({ full_name: "", phone: "", email: "" });
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<QuickLineState[]>([emptyQuickLine("k0")]);
  const [taxRate, setTaxRate] = useState(String(defaultTaxRate ?? 0));
  const [notes, setNotes] = useState("");
  const [markSent, setMarkSent] = useState(false);
  const [saving, start] = useTransition();
  const [matches, setMatches] = useState<ScoredCustomerMatch[]>([]);
  const [overrideReason, setOverrideReason] = useState("");

  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const tax = subtotal * (num(taxRate) / 100);

  // Landed catalog material cost (freight included). No job gas/car/commission
  // here — Quick Estimate is lighter than the full builder.
  const cost = lines.reduce((s, l) => {
    const p = l.productId ? products.find((x) => x.id === l.productId) : null;
    const bare = num(l.quantity) * Number(p?.cost ?? 0);
    return s + landedMaterialCost(bare, freightMarkupPct);
  }, 0);
  const known = lines.some((l) => {
    const p = l.productId ? products.find((x) => x.id === l.productId) : null;
    return Number(p?.cost ?? 0) > 0;
  });
  const margin = marginPct(subtotal, cost);

  const submit = (opts?: { useExistingId?: string; forceCreate?: boolean }) =>
    start(async () => {
      const res = await createQuickEstimate({
        customerId:
          opts?.useExistingId ||
          (mode === "existing" ? customerId || null : null),
        newCustomer: mode === "new" && !opts?.useExistingId ? nc : null,
        useExistingId: opts?.useExistingId ?? null,
        forceCreate: opts?.forceCreate,
        overrideReason: overrideReason || null,
        title,
        lines: lines.map((l) => {
          const p = l.productId ? products.find((x) => x.id === l.productId) : null;
          return {
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            rate: l.rate,
            cost: p?.cost ?? 0,
            productId: l.productId,
          };
        }),
        taxRate,
        notes,
        markSent,
      });
      if (res.matches?.length) {
        setMatches(res.matches);
        return;
      }
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(markSent ? "Estimate created and marked sent" : "Estimate created");
      router.push(res.estimateId ? `/estimates/${res.estimateId}` : "/estimates");
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who&apos;s it for</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(
              [
                ["new", "New customer", UserPlus],
                ["existing", "Existing customer", Users],
              ] as const
            ).map(([m, label, Icon]) => (
              <Button
                key={m}
                type="button"
                variant={mode === m ? "default" : "outline"}
                size="sm"
                onClick={() => setMode(m)}
              >
                <Icon className="size-4" />
                {label}
              </Button>
            ))}
          </div>

          {mode === "existing" ? (
            <SearchPicker
              options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Search customers…"
              allowClear
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                value={nc.full_name}
                onChange={(e) => setNc({ ...nc, full_name: e.target.value })}
                placeholder="Name"
                aria-label="Customer name"
              />
              <PhoneInput
                value={nc.phone}
                onChange={(e) => setNc({ ...nc, phone: e.target.value })}
                placeholder="Phone (optional)"
              />
              <Input
                value={nc.email}
                onChange={(e) => setNc({ ...nc, email: e.target.value })}
                placeholder="Email (optional)"
                type="email"
                aria-label="Customer email"
              />
            </div>
          )}
          {matches.length ? (
            <div className="space-y-2">
              {matches.some((m) => m.tier === "strong") ? (
                <input
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Reason for creating a new customer (required for strong matches)"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                />
              ) : null}
              <CustomerMatchPanel
                matches={matches}
                pending={saving}
                onUseExisting={(id) => submit({ useExistingId: id })}
                onCreateAnyway={() => submit({ forceCreate: true })}
              />
            </div>
          ) : null}

          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's it for — e.g. Kitchen & hall LVP"
            aria-label="Estimate title"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What you&apos;re quoting</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickLines lines={lines} products={products} onChange={setLines} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The number</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tax %</label>
              <Input
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-24"
              />
            </div>
            <div className="ml-auto text-right tabular-nums">
              <div className="text-sm text-muted-foreground">
                {formatMoney(subtotal)} + {formatMoney(tax)} tax
              </div>
              <div className="text-2xl font-semibold">
                {formatMoney(subtotal + tax)}
              </div>
            </div>
          </div>

          {/* The real margin, from catalog cost — not the target. */}
          <div className="rounded-md border bg-muted/30 p-2 text-sm">
            {known ? (
              <>
                Estimated margin before job overhead{" "}
                <span
                  className={
                    margin >= targetMargin - 0.05
                      ? "font-semibold text-emerald-600"
                      : "font-semibold text-amber-600"
                  }
                >
                  {margin.toFixed(1)}%
                </span>{" "}
                — {formatMoney(subtotal)} less {formatMoney(cost)} landed
                material cost
                {freightMarkupPct > 0
                  ? ` (incl. ${freightMarkupPct}% freight)`
                  : ""}
                .{" "}
                {margin >= targetMargin - 0.05
                  ? `At or above your ${targetMargin}% target.`
                  : `Below your ${targetMargin}% target.`}
              </>
            ) : (
              <span className="text-muted-foreground">
                Pick catalog products and the real margin shows here. Typed-in
                lines have no cost on file, so it can&apos;t be worked out.
              </span>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={markSent}
              onChange={(e) => setMarkSent(e.target.checked)}
              className="size-4"
            />
            Mark it sent (otherwise it saves as a draft)
          </label>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes (optional)"
            aria-label="Estimate notes"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => submit()} disabled={saving} size="lg">
          <FileText className="size-4" />
          {saving ? "Saving…" : "Create estimate"}
        </Button>
        <span className="text-sm text-muted-foreground">
          Opens in the full builder afterwards — add rooms, trims or a second
          option any time.
        </span>
      </div>
    </div>
  );
}

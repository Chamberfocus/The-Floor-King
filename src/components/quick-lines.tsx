"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPicker } from "@/components/ui/search-picker";
import { formatMoney } from "@/lib/format";
import { PRICE_NEEDED } from "@/lib/catalog-pricing";
import { catalogRemnantAlertsFor } from "@/app/(app)/catalog/actions";

export interface QuickLineState {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
}

export interface QuickProduct {
  id: string;
  name: string;
  unit: string;
  /** What we sell it for. */
  rate: number;
  /** True when catalog has no usable cost/sell (PRICE NEEDED). */
  priceNeeded?: boolean;
  manufacturer?: string | null;
  style?: string | null;
  color?: string | null;
  on_hand?: number | null;
  track_stock?: boolean | null;
}

export const emptyQuickLine = (key: string): QuickLineState => ({
  key,
  productId: null,
  description: "",
  quantity: "1",
  unit: "each",
  rate: "",
});

export function productLabel(p: QuickProduct): string {
  return [p.manufacturer, p.name, p.style, p.color].filter(Boolean).join(" · ");
}

const num = (v: string): number => {
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function lineTotal(l: QuickLineState): number {
  return num(l.quantity) * num(l.rate);
}

/**
 * The line editor shared by the quick invoice and the quick estimate.
 *
 * Picking a catalog product fills in the description, unit and price, so the
 * common case is one search and a quantity. Anything not in the catalog is just
 * typed — a counter sale shouldn't stall because a product was never set up.
 */
export function QuickLines({
  lines,
  products,
  onChange,
  showStock = false,
}: {
  lines: QuickLineState[];
  products: QuickProduct[];
  onChange: (lines: QuickLineState[]) => void;
  /** Show what's on hand — useful when the material is leaving today. */
  showStock?: boolean;
}) {
  const [remnantAlerts, setRemnantAlerts] = useState<
    Awaited<ReturnType<typeof catalogRemnantAlertsFor>>
  >({});
  const stockKey = products
    .filter((x) => x.track_stock)
    .map((x) => x.id)
    .sort()
    .join(",");
  useEffect(() => {
    const ids = stockKey ? stockKey.split(",") : [];
    if (!ids.length) {
      setRemnantAlerts({});
      return;
    }
    let cancelled = false;
    catalogRemnantAlertsFor(ids)
      .then((alerts) => {
        if (!cancelled) setRemnantAlerts(alerts);
      })
      .catch(() => {
        if (!cancelled) setRemnantAlerts({});
      });
    return () => {
      cancelled = true;
    };
  }, [stockKey]);

  const options = products.map((p) => ({
    value: p.id,
    label: productLabel(p),
    hint: p.priceNeeded ? PRICE_NEEDED : formatMoney(p.rate),
  }));

  const patch = (key: string, next: Partial<QuickLineState>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const pick = (key: string, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return patch(key, { productId: null });
    patch(key, {
      productId: p.id,
      description: productLabel(p),
      unit: p.unit || "",
      rate: p.priceNeeded ? "" : String(p.rate),
    });
  };

  return (
    <div className="space-y-3">
      {lines.map((l) => {
        const p = l.productId ? products.find((x) => x.id === l.productId) : null;
        const short =
          showStock && p?.track_stock && num(l.quantity) > Number(p.on_hand ?? 0);
        return (
          <div key={l.key} className="rounded-lg border p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-2">
                <SearchPicker
                  options={options}
                  value={l.productId ?? ""}
                  onChange={(v) => pick(l.key, v)}
                  placeholder="Search the catalog…"
                  allowClear
                />
                <Input
                  value={l.description}
                  onChange={(e) => patch(l.key, { description: e.target.value })}
                  placeholder="Or just describe it"
                  aria-label="Description"
                />
              </div>
              {lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove line"
                  onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Quantity
                </label>
                <Input
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => patch(l.key, { quantity: e.target.value })}
                  aria-invalid={short || undefined}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Unit</label>
                <Input
                  value={l.unit}
                  onChange={(e) => patch(l.key, { unit: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Price each
                </label>
                <Input
                  inputMode="decimal"
                  value={l.rate}
                  onChange={(e) => patch(l.key, { rate: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col justify-end">
                <div className="text-xs text-muted-foreground">Line total</div>
                <div className="text-lg font-semibold tabular-nums">
                  {formatMoney(lineTotal(l))}
                </div>
              </div>
            </div>

            {showStock && p?.track_stock ? (
              <p
                className={`mt-1.5 text-xs ${short ? "text-amber-600" : "text-muted-foreground"}`}
              >
                {(() => {
                  const remnantItems = remnantAlerts[p.id]?.items ?? [];
                  // Exclusive carpet-tile quick-lines on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
                  // Hard-surface quick-lines leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
                  const remnantUnits = remnantItems.map((i) => (i.unit || "").trim());
                  const mixedRemnant = new Set(remnantUnits).size > 1;
                  const onHandQty = mixedRemnant ? (remnantItems.length > 1 ? `stock across ${remnantItems.length} pieces` : "stock as a remnant/roll") : `${p.on_hand ?? 0} ${p.unit}`;
                  return short
                    ? `Only ${onHandQty} on hand — selling ${l.quantity} takes it negative.`
                    : `${onHandQty} on hand.`;
                })()}
              </p>
            ) : null}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([...lines, emptyQuickLine(`k${Date.now()}${lines.length}`)])
        }
      >
        <Plus className="size-4" />
        Add another line
      </Button>
    </div>
  );
}

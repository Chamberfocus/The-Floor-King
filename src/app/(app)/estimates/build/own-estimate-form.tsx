"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import { formatMoney } from "@/lib/format";
import { computeBillRecovery } from "@/lib/bill-recovery";
import { PRICE_NEEDED } from "@/lib/catalog-pricing";
import { lineCost, lineTotal, marginPct, num } from "@/lib/estimate-calc";
import { landedMaterialCost } from "@/lib/freight";
import {
  draftLineFromCustom,
  draftLineFromProduct,
  emptyOwnDraft,
  type OwnEstimateDraft,
} from "@/lib/own-estimate";
import { quickEstimateLineRow, rescaleQuotedUnit } from "@/lib/quick-estimate";
import type { Product, UserRole } from "@/lib/types";
import { normalizeUnit, unitLabel, unitsForCategory } from "@/lib/units";
import { ProductPicker, type CustomProductInput } from "../product-picker";
import { createQuickEstimate } from "../quick/actions";

type Draft = OwnEstimateDraft & { key: string };

function unitChoices(category: string | null, unit: string) {
  const options = unitsForCategory(category);
  const key = normalizeUnit(unit);
  if (key && !options.some((o) => o.value === key)) {
    return [{ value: key, label: unitLabel(key) || key }, ...options];
  }
  return options;
}

export function OwnEstimateForm({
  customerId,
  customerName,
  propertyLabel,
  serviceAddressId,
  defaultTaxRate,
  targetMargin,
  freightMarkupPct = 0,
  fuelCharge = 0,
  salespersonGas = 0,
  carAllowance = 0,
  commissionPct = 0,
  viewerRole = null,
}: {
  customerId: string;
  customerName: string;
  propertyLabel: string | null;
  serviceAddressId: string | null;
  defaultTaxRate: number;
  targetMargin: number;
  freightMarkupPct?: number;
  fuelCharge?: number;
  salespersonGas?: number;
  carAllowance?: number;
  commissionPct?: number;
  viewerRole?: UserRole | null;
}) {
  const router = useRouter();
  const seq = useRef(0);
  const nextKey = () => `line-${seq.current++}`;
  const [room, setRoom] = useState("");
  const [lines, setLines] = useState<Draft[]>([]);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [taxRate, setTaxRate] = useState(String(defaultTaxRate ?? 0));
  const [notes, setNotes] = useState("");
  const [markSent, setMarkSent] = useState(false);
  const [saving, start] = useTransition();

  const add = (draft: OwnEstimateDraft) => {
    const key = nextKey();
    setLines((prev) => [...prev, { ...draft, key }]);
    setFocusKey(key);
  };

  const addProduct = (product: Product) => {
    const draft = draftLineFromProduct(product, room, {
      targetMarginPct: targetMargin,
      freightMarkupPct,
    });
    add(draft);
    if ((product.category ?? "").toLowerCase() === "labor") {
      toast.message("Added as labor. Labor is the work, not a product.");
    }
  };

  const addCustom = (input: CustomProductInput) => {
    add(draftLineFromCustom(input, room));
  };

  const patch = (key: string, next: Partial<Draft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));

  const rows = lines.map((l, i) =>
    quickEstimateLineRow(
      {
        description: l.description || " ",
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        cost: l.cost,
        productId: l.productId,
        category: l.category,
        manufacturer: l.manufacturer,
        style: l.style,
        color: l.color,
        room: l.room,
        sku: l.sku,
        sqftPerBox: l.sqftPerBox,
        rollWidthFt: l.rollWidthFt,
        coverageSqft: l.coverageSqft,
        coverageThicknessIn: l.coverageThicknessIn,
      },
      i,
    ),
  );
  const subtotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const recovery = computeBillRecovery(subtotal, {
    fuelCharge,
    salespersonGas,
    carAllowance,
    commissionPct,
  });
  const pretax = recovery.customerRevenue;
  const tax = pretax * (num(taxRate) / 100);
  const materialCost = rows.reduce((s, r, i) => {
    if ((lines[i]?.category ?? "").toLowerCase() === "labor") return s;
    return s + landedMaterialCost(lineCost(r), freightMarkupPct);
  }, 0);
  const knownCost = lines.some(
    (l) => (l.category ?? "").toLowerCase() !== "labor" && num(l.cost) > 0,
  );
  const margin = marginPct(pretax, materialCost);

  const save = () =>
    start(async () => {
      const ready = lines.filter(
        (l) => l.description.trim() !== "" && num(l.quantity) > 0,
      );
      const started = lines.some(
        (l) => l.description.trim() !== "" || num(l.quantity) > 0,
      );
      if (!ready.length) {
        toast.error(
          started
            ? "Each line needs a name and how many."
            : "Search a product and type how many.",
        );
        return;
      }
      const missingUnit = ready.find((l) => !normalizeUnit(l.unit));
      if (missingUnit) {
        toast.error(`Pick a unit for ${missingUnit.description.trim()}.`);
        return;
      }
      const res = await createQuickEstimate({
        customerId,
        newCustomer: null,
        title,
        lines: ready.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          rate: l.rate,
          cost: l.cost,
          productId: l.productId,
          category: l.category,
          manufacturer: l.manufacturer,
          style: l.style,
          color: l.color,
          room: l.room,
          sku: l.sku,
          sqftPerBox: l.sqftPerBox,
          rollWidthFt: l.rollWidthFt,
          coverageSqft: l.coverageSqft,
          coverageThicknessIn: l.coverageThicknessIn,
        })),
        taxRate,
        notes,
        markSent,
        serviceAddressId,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(markSent ? "Estimate saved and marked sent" : "Estimate saved");
      router.push(res.estimateId ? `/estimates/${res.estimateId}` : "/estimates");
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{customerName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {propertyLabel ? (
            <p className="text-sm text-muted-foreground">{propertyLabel}</p>
          ) : null}
          <div>
            <label htmlFor="own-room" className="mb-1 block text-xs font-medium text-muted-foreground">
              Room for the next line
            </label>
            <Input
              id="own-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Living room, kitchen… leave blank for the whole job"
            />
          </div>
          <ProductPicker
            value=""
            label="Search a product"
            fullWidth
            purpose="sell"
            openOnFocus
            viewerRole={viewerRole}
            onPick={(p) => {
              if (p) addProduct(p);
            }}
            onCreated={addProduct}
            onUseOnce={addCustom}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => add(emptyOwnDraft(room))}
          >
            <Wrench className="size-4" /> Add labor
          </Button>
          <p className="text-xs text-muted-foreground">
            Labor is the work — tear-out, install, a move. It is not something you
            order.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. Search a product, or add labor.
            </p>
          ) : (
            lines.map((l, i) => {
              const choices = unitChoices(l.category, l.unit);
              const total = lineTotal(rows[i]!);
              const labor = (l.category ?? "").toLowerCase() === "labor";
              return (
                <div key={l.key} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Input
                      value={l.room}
                      onChange={(e) => patch(l.key, { room: e.target.value })}
                      placeholder="Whole job"
                      aria-label="Room"
                      className="h-8"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove line"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  <Input
                    value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value })}
                    placeholder={labor ? "What work — install, tear-out, move appliances" : "Product"}
                    aria-label={labor ? "Labor" : "Product"}
                  />
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-24">
                      <label className="mb-1 block text-xs text-muted-foreground">How many</label>
                      <Input
                        inputMode="decimal"
                        value={l.quantity}
                        autoFocus={l.key === focusKey}
                        onChange={(e) => patch(l.key, { quantity: e.target.value })}
                        aria-label="Quantity"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-xs text-muted-foreground">Unit</label>
                      {choices.length > 6 ? (
                        <select
                          value={normalizeUnit(l.unit)}
                          onChange={(e) =>
                            patch(l.key, rescaleQuotedUnit(l, e.target.value))
                          }
                          aria-label="Unit"
                          className="h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                        >
                          <option value="">Pick a unit</option>
                          {choices.map((u) => (
                            <option key={u.value} value={u.value}>
                              {u.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <SegmentedField
                          size="sm"
                          options={choices.map((u) => ({ value: u.value, label: u.label }))}
                          value={normalizeUnit(l.unit)}
                          onChange={(unit) => patch(l.key, rescaleQuotedUnit(l, unit))}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-28">
                      <label className="mb-1 block text-xs text-muted-foreground">Price</label>
                      <Input
                        inputMode="decimal"
                        value={l.rate}
                        onChange={(e) => patch(l.key, { rate: e.target.value })}
                        placeholder="0"
                        aria-label="Price"
                      />
                    </div>
                    <div className="w-28">
                      <label className="mb-1 block text-xs text-muted-foreground">Our cost</label>
                      <Input
                        inputMode="decimal"
                        value={l.cost}
                        onChange={(e) => patch(l.key, { cost: e.target.value })}
                        placeholder="0"
                        aria-label="Our cost"
                      />
                    </div>
                    <div className="ml-auto pb-2 text-right tabular-nums">
                      <div className="text-sm font-medium">{formatMoney(total)}</div>
                      {l.rate.trim() === "" ? (
                        <div className="text-xs font-medium text-amber-600">{PRICE_NEEDED}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Total</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's it for — e.g. Living room carpet"
            aria-label="Estimate title"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Tax %</label>
              <Input
                inputMode="decimal"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                className="w-24"
                aria-label="Tax percent"
              />
            </div>
            <div className="ml-auto text-right tabular-nums">
              <div className="text-sm text-muted-foreground">
                {formatMoney(pretax)} + {formatMoney(tax)} tax
              </div>
              <div className="text-2xl font-semibold">{formatMoney(pretax + tax)}</div>
              {recovery.added > 0 ? (
                <div className="text-xs text-muted-foreground">
                  Includes {formatMoney(recovery.added)} gas, car allowance, and
                  commission, in the price.
                </div>
              ) : null}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-2 text-sm">
            {knownCost ? (
              <>
                Margin on the customer total{" "}
                <span
                  className={
                    margin >= targetMargin - 0.05
                      ? "font-semibold text-emerald-600"
                      : "font-semibold text-amber-600"
                  }
                >
                  {margin.toFixed(1)}%
                </span>
                . Target is {targetMargin}%.
              </>
            ) : (
              <span className="text-muted-foreground">
                A catalog product with a cost shows the margin here. Gas, car
                allowance, and commission stay in the customer total — they are
                not baked into the line.
              </span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Notes for the work order"
            aria-label="Work order notes"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={markSent}
              onChange={(e) => setMarkSent(e.target.checked)}
              className="size-4"
            />
            Mark it sent (otherwise it saves as a draft)
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={saving} size="lg">
          <FileText className="size-4" />
          {saving ? "Saving…" : "Save estimate"}
        </Button>
        <span className="text-sm text-muted-foreground">
          Cuts, waste, and a second option are on Edit after this saves. The
          purchase order and work order use these lines.
        </span>
      </div>
    </div>
  );
}

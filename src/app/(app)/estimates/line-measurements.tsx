"use client";

import { Plus, Trash2, Minus, Ruler } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { num } from "@/lib/estimate-calc";
import { isRollGoodCategory, isHardSurfaceCategory } from "@/lib/types";

/** One measured piece as the builder edits it (feet+inches as strings). */
export interface MeasureRow {
  id: string;
  label: string;
  len_ft: string;
  len_in: string;
  wid_ft: string;
  wid_in: string;
  op: "add" | "subtract";
}

let mrid = 0;
export const newMeasureRow = (label = ""): MeasureRow => ({
  id: `m${mrid++}`,
  label,
  len_ft: "",
  len_in: "",
  wid_ft: "",
  wid_in: "",
  op: "add",
});

const rowFeet = (ft: string, inch: string) => num(ft) + num(inch) / 12;
export const rowSqftSigned = (m: MeasureRow) => {
  const a = rowFeet(m.len_ft, m.len_in) * rowFeet(m.wid_ft, m.wid_in);
  return m.op === "subtract" ? -a : a;
};
export const rowsSqft = (rows: MeasureRow[]) =>
  Math.round(rows.reduce((s, m) => s + rowSqftSigned(m), 0) * 100) / 100;

const dim = "h-9 w-14 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const dimSm = "h-9 w-12 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The measurement flow for a flooring line — a persistent, add-as-you-go list of
 * measured pieces that sums to the line's square footage. For carpet / sheet
 * vinyl each "add" piece is a CUT off the roll (it flows to the staging sheet);
 * for hard surface the pieces just build up the square footage (subtract a piece
 * for a cutout), and cartons are figured from sq ft ÷ sq ft per box.
 */
export function LineMeasurements({
  category,
  rows,
  onChange,
  sqftPerBox,
  onSqftPerBoxChange,
}: {
  category: string;
  rows: MeasureRow[];
  onChange: (rows: MeasureRow[]) => void;
  sqftPerBox: string;
  onSqftPerBoxChange: (v: string) => void;
}) {
  const isRoll = isRollGoodCategory(category);
  const isHard = isHardSurfaceCategory(category);
  const pieceWord = isRoll ? "cut" : "area";

  const total = rowsSqft(rows);
  const addCount = rows.filter((r) => r.op === "add").length;
  const sqyd = Math.round((total / 9) * 100) / 100;
  const perBox = num(sqftPerBox);
  const cartons = perBox > 0 && total > 0 ? Math.ceil(total / perBox) : 0;

  const update = (id: string, patch: Partial<MeasureRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  const add = () => onChange([...rows, newMeasureRow()]);

  return (
    <div className="w-full space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Ruler className="size-3.5" />
          {isRoll ? "Cuts & areas" : "Measurements"}
        </div>
        <div className="text-xs font-medium tabular-nums text-muted-foreground">
          {total > 0 ? (
            <>
              {total.toFixed(total % 1 === 0 ? 0 : 1)} sq ft
              {isRoll ? ` · ${sqyd.toFixed(1)} sq yd` : ""}
            </>
          ) : (
            "0 sq ft"
          )}
        </div>
      </div>

      {rows.length ? (
        <div className="space-y-1.5">
          {rows.map((m) => {
            const rSqft = Math.abs(rowSqftSigned(m));
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-1.5">
                <Input
                  value={m.label}
                  onChange={(e) => update(m.id, { label: e.target.value })}
                  placeholder={isRoll ? "Room / piece" : "Area"}
                  className="h-9 min-w-28 flex-1"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number" step="any" min="0" inputMode="decimal"
                    value={m.len_ft}
                    onChange={(e) => update(m.id, { len_ft: e.target.value })}
                    placeholder="ft" aria-label="Length feet" className={dim}
                  />
                  <input
                    type="number" step="any" min="0" inputMode="decimal"
                    value={m.len_in}
                    onChange={(e) => update(m.id, { len_in: e.target.value })}
                    placeholder="in" aria-label="Length inches" className={dimSm}
                  />
                  <span className="px-0.5 text-xs text-muted-foreground">×</span>
                  <input
                    type="number" step="any" min="0" inputMode="decimal"
                    value={m.wid_ft}
                    onChange={(e) => update(m.id, { wid_ft: e.target.value })}
                    placeholder="ft" aria-label="Width feet" className={dim}
                  />
                  <input
                    type="number" step="any" min="0" inputMode="decimal"
                    value={m.wid_in}
                    onChange={(e) => update(m.id, { wid_in: e.target.value })}
                    placeholder="in" aria-label="Width inches" className={dimSm}
                  />
                </div>
                {/* Hard surface can subtract a cutout; carpet cuts only add. */}
                {isHard ? (
                  <button
                    type="button"
                    onClick={() => update(m.id, { op: m.op === "add" ? "subtract" : "add" })}
                    className={cn(
                      "inline-flex h-9 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                      m.op === "subtract"
                        ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300"
                        : "text-muted-foreground",
                    )}
                    aria-label={m.op === "subtract" ? "Subtracting a cutout" : "Adding an area"}
                    title={m.op === "subtract" ? "Cutout (subtracts)" : "Area (adds)"}
                  >
                    {m.op === "subtract" ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
                    {m.op === "subtract" ? "cutout" : "add"}
                  </button>
                ) : null}
                <span
                  className={cn(
                    "w-20 text-right text-xs tabular-nums",
                    m.op === "subtract" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                  )}
                >
                  {rSqft > 0 ? `${m.op === "subtract" ? "−" : ""}${rSqft.toFixed(rSqft % 1 === 0 ? 0 : 1)} sf` : "—"}
                </span>
                <Button
                  type="button" variant="ghost" size="icon-sm"
                  aria-label={`Remove ${pieceWord}`}
                  onClick={() => remove(m.id)}
                >
                  <Trash2 className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="px-0.5 text-xs text-muted-foreground">
          {isRoll
            ? "Add each cut you'll pull off the roll (room + length × width). They add up to the sq yd, and each one prints on the warehouse cut sheet."
            : "Add each area (length × width). They add up to the total square footage as you go — subtract a piece for a cutout."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-3.5" /> Add {pieceWord}
        </Button>

        {isRoll && addCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            {addCount} cut{addCount === 1 ? "" : "s"} → warehouse
          </span>
        ) : null}

        {isHard ? (
          <div className="ml-auto flex items-center gap-1.5">
            <label className="text-xs text-muted-foreground">Sq ft / box</label>
            <input
              type="number" step="any" min="0" inputMode="decimal"
              value={sqftPerBox}
              onChange={(e) => onSqftPerBoxChange(e.target.value)}
              placeholder="—"
              className="h-9 w-20 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {cartons > 0 ? (
              <span className="text-xs font-medium text-foreground">= {cartons} carton{cartons === 1 ? "" : "s"}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

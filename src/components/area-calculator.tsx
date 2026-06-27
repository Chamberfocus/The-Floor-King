"use client";

import { useState } from "react";
import { Calculator, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const n = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

interface Seg {
  id: string;
  label: string;
  op: "add" | "subtract"; // add an area (L-shape piece) or subtract a cutout
  lf: string; // length feet
  li: string; // length inches
  wf: string; // width feet
  wi: string; // width inches
}

let sid = 0;
const newSeg = (label = ""): Seg => ({
  id: `s${sid++}`,
  label,
  op: "add",
  lf: "",
  li: "",
  wf: "",
  wi: "",
});

/** Feet from a feet+inches pair. */
const feet = (ft: string, inch: string) => n(ft) + n(inch) / 12;
const segSqft = (s: Seg) => feet(s.lf, s.li) * feet(s.wf, s.wi);
/** Signed contribution: cutouts subtract from the total. */
const segSigned = (s: Seg) => (s.op === "subtract" ? -segSqft(s) : segSqft(s));
const segPerim = (s: Seg) => 2 * (feet(s.lf, s.li) + feet(s.wf, s.wi));
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Multi-area square-footage calculator. Add a row per area (room, closet,
 * hallway), enter length × width in feet + inches, and it totals to sq ft and
 * sq yd. If `onApply` is given it can push the total back into an estimate room;
 * otherwise it's just a quick calculator.
 */
export function AreaCalculator({
  triggerLabel = "Area calculator",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  title = "Square footage calculator",
  initialLabel,
  onApply,
}: {
  triggerLabel?: string;
  triggerVariant?: "outline" | "ghost" | "default";
  triggerSize?: "sm" | "default" | "lg" | "icon-sm";
  triggerClassName?: string;
  title?: string;
  initialLabel?: string;
  onApply?: (sqft: number, perimeter: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [segs, setSegs] = useState<Seg[]>([newSeg(initialLabel)]);

  const set = (id: string, patch: Partial<Seg>) =>
    setSegs((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const totalSqft = Math.max(0, segs.reduce((a, s) => a + segSigned(s), 0));
  const totalSqyd = totalSqft / 9;
  // Cutouts don't add room perimeter — only count the added areas.
  const totalPerim = segs.reduce((a, s) => a + (s.op === "add" ? segPerim(s) : 0), 0);

  const reset = () => setSegs([newSeg(initialLabel)]);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <Calculator className="size-3.5" /> {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Add a row for each area — room, closet, hallway. For an irregular
              room, add each rectangle; tap <strong>+</strong> to switch a row to
              <strong> − cut out</strong> to subtract an island, hearth, or other
              area that isn&apos;t getting floor. It totals the square footage
              (and square yards for carpet).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="hidden grid-cols-[auto_1fr_auto_auto_auto] gap-2 px-1 text-[11px] text-muted-foreground sm:grid">
              <span className="w-9" />
              <span>Area</span>
              <span className="text-center">Length (ft / in)</span>
              <span className="text-center">Width (ft / in)</span>
              <span className="pr-7 text-right">Sq ft</span>
            </div>

            {segs.map((s, i) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-2 sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto]"
              >
                <button
                  type="button"
                  onClick={() => set(s.id, { op: s.op === "add" ? "subtract" : "add" })}
                  title={s.op === "subtract" ? "Cutout — subtracts from the total" : "Adds to the total"}
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md border text-lg font-bold",
                    s.op === "subtract"
                      ? "border-destructive/50 bg-destructive/10 text-destructive"
                      : "border-input text-primary",
                  )}
                >
                  {s.op === "subtract" ? "−" : "+"}
                </button>
                <Input
                  value={s.label}
                  onChange={(e) => set(s.id, { label: e.target.value })}
                  placeholder={
                    s.op === "subtract"
                      ? "Cutout (island, hearth…)"
                      : i === 0
                        ? "e.g. Living room"
                        : "Area / closet"
                  }
                  className="h-9 min-w-[7rem] flex-1 sm:flex-none"
                />
                <div className="flex gap-1">
                  <Input
                    value={s.lf}
                    onChange={(e) => set(s.id, { lf: e.target.value })}
                    inputMode="decimal"
                    placeholder="ft"
                    className="h-9 w-14"
                  />
                  <Input
                    value={s.li}
                    onChange={(e) => set(s.id, { li: e.target.value })}
                    inputMode="decimal"
                    placeholder="in"
                    className="h-9 w-12"
                  />
                </div>
                <div className="flex gap-1">
                  <Input
                    value={s.wf}
                    onChange={(e) => set(s.id, { wf: e.target.value })}
                    inputMode="decimal"
                    placeholder="ft"
                    className="h-9 w-14"
                  />
                  <Input
                    value={s.wi}
                    onChange={(e) => set(s.id, { wi: e.target.value })}
                    inputMode="decimal"
                    placeholder="in"
                    className="h-9 w-12"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={cn(
                      "w-14 text-right text-sm tabular-nums",
                      s.op === "subtract" && "text-destructive",
                    )}
                  >
                    {segSqft(s) > 0
                      ? `${s.op === "subtract" ? "−" : ""}${r2(segSqft(s))}`
                      : "—"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove area"
                    disabled={segs.length === 1}
                    onClick={() =>
                      setSegs((ss) => ss.filter((x) => x.id !== s.id))
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSegs((ss) => [...ss, newSeg()])}
            >
              <Plus className="size-3.5" /> Add area
            </Button>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex gap-6">
              <div>
                <div className="text-xs text-muted-foreground">Total sq ft</div>
                <div className="text-2xl font-bold tabular-nums">
                  {r2(totalSqft)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Total sq yd (carpet)
                </div>
                <div className="text-2xl font-bold tabular-nums text-primary">
                  {r2(totalSqyd)}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>

          <DialogFooter className={cn(!onApply && "sm:justify-end")}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              {onApply ? "Cancel" : "Close"}
            </Button>
            {onApply ? (
              <Button
                type="button"
                disabled={totalSqft <= 0}
                onClick={() => {
                  onApply(r2(totalSqft), r2(totalPerim));
                  setOpen(false);
                }}
              >
                Use {r2(totalSqft)} sq ft
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

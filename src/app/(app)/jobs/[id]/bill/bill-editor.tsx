"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Save, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InstallerBillLine, BillLineSource, InstallerBillStatus } from "@/lib/types";
import {
  saveInstallerBillDraft,
  approveInstallerBill,
  type BillLineInput,
} from "./actions";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const parseNum = (v: string): number | null => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const numOr0 = (v: string) => parseNum(v) ?? 0;

interface EditLine {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  source: BillLineSource;
  is_modified: boolean;
  change_reason: string;
}

export function BillEditor({
  billId,
  jobId,
  status,
  estimatedLaborCost,
  initialLines,
  initialAdjustments,
  initialNotes,
}: {
  billId: string;
  jobId: string;
  status: InstallerBillStatus;
  estimatedLaborCost: number | null;
  initialLines: InstallerBillLine[];
  initialAdjustments: number;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const locked = status !== "draft";

  const [lines, setLines] = useState<EditLine[]>(
    initialLines.map((l, i) => ({
      key: l.id || `row-${i}`,
      description: l.description ?? "",
      quantity: l.quantity != null ? String(l.quantity) : "",
      unit: l.unit ?? "",
      rate: l.rate != null ? String(l.rate) : "",
      source: l.source,
      is_modified: l.is_modified,
      change_reason: l.change_reason ?? "",
    })),
  );
  const [adjustments, setAdjustments] = useState(String(initialAdjustments || ""));
  // Notes aren't edited on this screen; carry the stored value through unchanged.
  const notes = initialNotes ?? "";
  // Stable keys for freshly added rows without Math.random / Date.now.
  const [addSeq, setAddSeq] = useState(0);

  const estimated = estimatedLaborCost ?? 0;
  const subtotal = useMemo(
    () => round2(lines.reduce((s, l) => s + numOr0(l.quantity) * numOr0(l.rate), 0)),
    [lines],
  );
  const total = round2(subtotal + numOr0(adjustments));
  const variance = round2(total - estimated);

  const needsReason = (l: EditLine) =>
    (l.is_modified || l.source === "manually_added") && !l.change_reason.trim();
  const anyMissingReason = lines.some(needsReason);

  const patch = (key: string, next: Partial<EditLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...next } : l)));

  // Editing quantity or rate flags the line as modified (spec STEP 3).
  const editQty = (key: string, v: string) =>
    patch(key, { quantity: v, is_modified: true });
  const editRate = (key: string, v: string) =>
    patch(key, { rate: v, is_modified: true });

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: `new-${addSeq}`,
        description: "",
        quantity: "",
        unit: "",
        rate: "",
        source: "manually_added",
        is_modified: false,
        change_reason: "",
      },
    ]);
    setAddSeq((n) => n + 1);
  };
  const removeLine = (key: string) =>
    setLines((prev) => prev.filter((l) => l.key !== key));

  const buildInput = (): BillLineInput[] =>
    lines.map((l) => ({
      description: l.description,
      quantity: parseNum(l.quantity),
      unit: l.unit.trim() || null,
      rate: parseNum(l.rate),
      source: l.source,
      is_modified: l.is_modified,
      change_reason: l.change_reason.trim() || null,
    }));

  const save = () =>
    start(async () => {
      const res = await saveInstallerBillDraft({
        billId,
        jobId,
        adjustments: numOr0(adjustments),
        notes: notes.trim() || null,
        lines: buildInput(),
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Draft saved");
        router.refresh();
      }
    });

  const approve = () =>
    start(async () => {
      const res = await approveInstallerBill({
        billId,
        jobId,
        adjustments: numOr0(adjustments),
        notes: notes.trim() || null,
        lines: buildInput(),
      });
      if (res.error) toast.error(res.error);
      else {
        toast.success("Bill approved for payment");
        router.refresh();
      }
    });

  const varianceTone =
    variance < 0
      ? "text-emerald-600 dark:text-emerald-400"
      : variance > 0
        ? "text-destructive"
        : "text-muted-foreground";
  const varianceLabel =
    variance < 0 ? "under estimate" : variance > 0 ? "over estimate" : "on estimate";

  return (
    <div className="space-y-6">
      {/* Comparison strip — live */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Estimated labor
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {estimatedLaborCost == null ? "—" : formatMoney(estimated)}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Current bill
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{formatMoney(total)}</div>
        </div>
        <div className="rounded-lg border bg-card p-4 text-center shadow-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Variance
          </div>
          <div className={cn("mt-1 text-2xl font-bold tabular-nums", varianceTone)}>
            {variance > 0 ? "+" : ""}
            {formatMoney(variance)}
          </div>
          <div className={cn("text-[11px]", varianceTone)}>{varianceLabel}</div>
        </div>
      </div>

      {/* Line items */}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Qty</th>
              <th className="w-20 px-3 py-2 font-medium">Unit</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Rate</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Line total</th>
              {!locked ? <th className="w-10 px-2 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={locked ? 5 : 6} className="px-3 py-6 text-center text-muted-foreground">
                  This job&apos;s work order has no labor scope, so there are no
                  lines to bill. Add a line below to build the bill by hand.
                </td>
              </tr>
            ) : (
              lines.map((l) => {
                const lineTotal = round2(numOr0(l.quantity) * numOr0(l.rate));
                const isManual = l.source === "manually_added";
                const flagged = l.is_modified || isManual;
                const reasonMissing = needsReason(l);
                return (
                  <tr key={l.key} className="border-b align-top last:border-b-0">
                    <td className="px-3 py-2">
                      {locked || l.source === "from_work_order" ? (
                        <span className="font-medium">{l.description || "Labor"}</span>
                      ) : (
                        <Input
                          value={l.description}
                          onChange={(e) => patch(l.key, { description: e.target.value })}
                          placeholder="Describe the labor"
                          className="h-8"
                        />
                      )}
                      {flagged ? (
                        <span
                          className={cn(
                            "ml-0 mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            isManual
                              ? "bg-primary/10 text-primary"
                              : "bg-amber-500/10 text-amber-600",
                          )}
                        >
                          <Pencil className="size-3" />
                          {isManual ? "Added" : "Edited"}
                        </span>
                      ) : null}
                      {flagged ? (
                        locked ? (
                          l.change_reason ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Reason: {l.change_reason}
                            </div>
                          ) : null
                        ) : (
                          <Input
                            value={l.change_reason}
                            onChange={(e) => patch(l.key, { change_reason: e.target.value })}
                            placeholder="Reason for the change (required)"
                            className={cn(
                              "mt-1 h-7 text-xs",
                              reasonMissing && "border-destructive",
                            )}
                          />
                        )
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {locked ? (
                        <span className="tabular-nums">{l.quantity || "—"}</span>
                      ) : (
                        <Input
                          value={l.quantity}
                          onChange={(e) => editQty(l.key, e.target.value)}
                          inputMode="decimal"
                          className="h-8 text-right"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {locked || l.source === "from_work_order" ? (
                        <span className="text-muted-foreground">{l.unit || "—"}</span>
                      ) : (
                        <Input
                          value={l.unit}
                          onChange={(e) => patch(l.key, { unit: e.target.value })}
                          placeholder="unit"
                          className="h-8"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {locked ? (
                        <span className="tabular-nums">{formatMoney(numOr0(l.rate))}</span>
                      ) : (
                        <Input
                          value={l.rate}
                          onChange={(e) => editRate(l.key, e.target.value)}
                          inputMode="decimal"
                          className="h-8 text-right"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {formatMoney(lineTotal)}
                    </td>
                    {!locked ? (
                      <td className="px-2 py-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Remove line"
                          onClick={() => removeLine(l.key)}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {!locked ? (
          <div className="border-t p-2">
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="size-4" /> Add line item
            </Button>
          </div>
        ) : null}
      </div>

      {/* Footer: subtotal / adjustments / total + actions */}
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full max-w-xs space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-semibold tabular-nums">{formatMoney(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Adjustments</span>
            {locked ? (
              <span className="font-semibold tabular-nums">{formatMoney(numOr0(adjustments))}</span>
            ) : (
              <Input
                value={adjustments}
                onChange={(e) => setAdjustments(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="h-8 w-28 text-right"
              />
            )}
          </div>
          <div className="flex items-center justify-between border-t pt-2 text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
        </div>

        {!locked ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={save} disabled={pending}>
              <Save className="size-4" /> Save draft
            </Button>
            <Button
              type="button"
              onClick={approve}
              disabled={pending || anyMissingReason}
              title={
                anyMissingReason
                  ? "Add a change reason to every modified or added line first"
                  : undefined
              }
            >
              <CheckCircle2 className="size-4" /> Approve for payment
            </Button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Lock className="size-4" /> Locked — the bill has been {status}.
          </div>
        )}
      </div>
    </div>
  );
}

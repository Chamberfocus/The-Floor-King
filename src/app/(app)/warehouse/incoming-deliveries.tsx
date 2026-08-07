"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Truck, PackageCheck, AlertTriangle, ChevronDown, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { receivePoLines, unreceivePoLine } from "./receiving-actions";

import type { IncomingPoRow, IncomingPoItem } from "./receiving-actions";

// Re-exported so the page has one name to import.
export type IncomingItem = IncomingPoItem;
export type IncomingPo = IncomingPoRow;

const num = (v: string) => {
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** What the box should say on it, so a delivery can be matched by eye. */
function itemLabel(i: IncomingItem): string {
  return (
    [i.manufacturer, i.description, i.style, i.color].filter(Boolean).join(" · ") ||
    "Item"
  );
}

function PoCard({ po }: { po: IncomingPo }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, start] = useTransition();
  // Pre-filled with what was ordered — the common case is that it all arrived,
  // and typing the same number 12 times is how checking stops happening.
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      po.items.map((i) => [
        i.id,
        String(i.received_qty ?? i.quantity ?? 0),
      ]),
    ),
  );
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.items.map((i) => [i.id, i.receiving_note ?? ""])),
  );
  const [poNote, setPoNote] = useState("");

  const checked = po.items.filter((i) => i.received_at).length;
  const short = po.items.reduce(
    (s, i) => s + Math.max(Number(i.quantity ?? 0) - Number(i.received_qty ?? 0), 0),
    0,
  );
  const allChecked = po.items.length > 0 && checked === po.items.length;
  const complete = allChecked && short <= 0.005;

  const submit = () =>
    start(async () => {
      const res = await receivePoLines({
        poId: po.id,
        lines: po.items.map((i) => ({
          itemId: i.id,
          receivedQty: counts[i.id] ?? "0",
          note: notes[i.id] ?? "",
        })),
        note: poNote,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.fullyReceived
          ? "All received — the job's materials are marked arrived"
          : `Checked in. ${(res.short ?? 0).toFixed(2)} still outstanding.`,
      );
      router.refresh();
    });

  const undo = (itemId: string) =>
    start(async () => {
      await unreceivePoLine({ poId: po.id, itemId });
      router.refresh();
    });

  return (
    <div
      className={cn(
        "rounded-lg border",
        po.backordered && "border-amber-300 dark:border-amber-900",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left"
      >
        <Truck className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {po.po_number ? `PO-${po.po_number}` : "Draft PO"}
              {po.supplier ? ` · ${po.supplier}` : ""}
            </span>
            {complete ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                Received
              </Badge>
            ) : allChecked ? (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Short {short}
              </Badge>
            ) : checked > 0 ? (
              <Badge variant="outline">
                {checked} of {po.items.length} checked
              </Badge>
            ) : (
              <Badge variant="outline">{po.items.length} items to check</Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {[po.customerName, po.jobTitle].filter(Boolean).join(" · ") ||
              "No job attached"}
            {po.eta_date ? ` · ETA ${formatDate(po.eta_date)}` : " · no ETA"}
          </p>
        </div>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="border-t p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Count what actually arrived. It&apos;s pre-filled with what was
            ordered — change anything that doesn&apos;t match and say why.
          </p>

          <div className="space-y-2">
            {po.items.map((i) => {
              const entered = num(counts[i.id] ?? "0");
              const ordered = Number(i.quantity ?? 0);
              const differs = Math.abs(entered - ordered) > 0.005;
              return (
                <div
                  key={i.id}
                  className={cn(
                    "rounded-md border p-2",
                    differs && "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
                  )}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{itemLabel(i)}</p>
                      <p className="text-xs text-muted-foreground">
                        Ordered {ordered} {i.unit}
                        {i.item_no ? ` · item ${i.item_no}` : ""}
                        {i.received_at ? ` · checked ${formatDate(i.received_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-end gap-2">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          Arrived
                        </label>
                        <Input
                          inputMode="decimal"
                          value={counts[i.id] ?? ""}
                          onChange={(e) =>
                            setCounts({ ...counts, [i.id]: e.target.value })
                          }
                          className="w-24"
                          aria-label={`Quantity received for ${itemLabel(i)}`}
                        />
                      </div>
                      {i.received_at ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Undo this line"
                          onClick={() => undo(i.id)}
                          disabled={saving}
                        >
                          <Undo2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {differs ? (
                    <Input
                      value={notes[i.id] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })}
                      placeholder="What's wrong — short, wrong colour, damaged?"
                      className="mt-2"
                      aria-label={`Note for ${itemLabel(i)}`}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <Input
            value={poNote}
            onChange={(e) => setPoNote(e.target.value)}
            placeholder="Note for the whole delivery (optional)"
            className="mt-3"
            aria-label="Delivery note"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={saving}>
              <PackageCheck className="size-4" />
              {saving ? "Saving…" : "Check this delivery in"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {po.items.every(
                (i) => Math.abs(num(counts[i.id] ?? "0") - Number(i.quantity ?? 0)) <= 0.005,
              )
                ? "Everything matches — this marks the PO received and the job's materials arrived."
                : "Something doesn't match — the PO stays open and flags as backordered."}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What's on order and what's landed. The warehouse could see jobs to stage but
 * never the purchase orders behind them, so there was no way to check a
 * delivery against what was actually ordered.
 */
export function IncomingDeliveries({ pos }: { pos: IncomingPo[] }) {
  const waiting = pos.filter((p) => p.status === "ordered");
  const problems = pos.filter((p) => p.backordered);

  if (!pos.length) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nothing on order right now. Purchase orders show up here the moment
        they&apos;re placed.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {problems.length ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="size-4 text-amber-600" />
          <span>
            <strong>{problems.length}</strong>{" "}
            {problems.length === 1 ? "delivery came" : "deliveries came"} in short
            or wrong — the office needs to chase{" "}
            {problems.length === 1 ? "it" : "them"}.
          </span>
        </div>
      ) : null}

      {waiting.map((po) => (
        <PoCard key={po.id} po={po} />
      ))}

      {pos.filter((p) => p.status === "received").length ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Already received ({pos.filter((p) => p.status === "received").length})
          </summary>
          <div className="mt-3 space-y-3">
            {pos
              .filter((p) => p.status === "received")
              .map((po) => (
                <PoCard key={po.id} po={po} />
              ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

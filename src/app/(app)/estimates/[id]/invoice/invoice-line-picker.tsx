"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createInvoiceFromSelection } from "@/app/(app)/invoices/actions";

interface Item {
  id: string;
  label: string;
  amount: number;
}
interface Group {
  room: string;
  items: Item[];
}

/**
 * Compartmentalized invoice builder: line items grouped by room with a
 * select-all per group, subtotals, and a live "selected" total — so nothing
 * gets missed. Submits the chosen line ids to the unchanged create action.
 */
export function InvoiceLinePicker({
  estimateId,
  groups,
}: {
  estimateId: string;
  groups: Group[];
}) {
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const [sel, setSel] = useState<Set<string>>(new Set(allIds));

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setGroup = (g: Group, on: boolean) =>
    setSel((s) => {
      const n = new Set(s);
      g.items.forEach((i) => (on ? n.add(i.id) : n.delete(i.id)));
      return n;
    });

  const total = groups
    .flatMap((g) => g.items)
    .filter((i) => sel.has(i.id))
    .reduce((a, i) => a + i.amount, 0);

  return (
    <form action={createInvoiceFromSelection} className="space-y-3">
      <input type="hidden" name="estimate_id" value={estimateId} />

      {groups.map((g) => {
        const onCount = g.items.filter((i) => sel.has(i.id)).length;
        const allOn = onCount === g.items.length;
        const sub = g.items
          .filter((i) => sel.has(i.id))
          .reduce((a, i) => a + i.amount, 0);
        return (
          <div key={g.room} className="overflow-hidden rounded-lg border">
            <label className="flex cursor-pointer items-center gap-2 bg-muted/50 px-3 py-2">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = onCount > 0 && !allOn;
                }}
                onChange={(e) => setGroup(g, e.target.checked)}
                className="size-4 rounded border-input"
              />
              <span className="flex-1 text-sm font-semibold">{g.room}</span>
              <span className="text-xs text-muted-foreground">
                {onCount}/{g.items.length} · {formatMoney(sub)}
              </span>
            </label>
            <ul className="divide-y">
              {g.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-1.5">
                  <input
                    type="checkbox"
                    name="line"
                    value={i.id}
                    checked={sel.has(i.id)}
                    onChange={() => toggle(i.id)}
                    className="size-4 rounded border-input"
                  />
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      !sel.has(i.id) && "text-muted-foreground line-through",
                    )}
                  >
                    {i.label}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {formatMoney(i.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 shadow-lg">
        <div className="text-sm">
          <span className="text-muted-foreground">Selected: </span>
          <span className="font-semibold">{sel.size} item{sel.size === 1 ? "" : "s"}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-lg font-bold">{formatMoney(total)}</span>
        </div>
        <Button type="submit" disabled={sel.size === 0}>
          <Receipt className="size-4" /> Create invoice from selected
        </Button>
      </div>
    </form>
  );
}

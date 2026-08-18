import { Scissors } from "lucide-react";
import { cutLines, cutsTotalSqYd } from "@/lib/order-cuts";
import type { OrderCutRow } from "@/lib/types";

/**
 * A customer's measurements, listed.
 *
 * These used to print as one comma-run ("Cuts: 12' × 14'6", 12' × 10'"), which
 * is the format you least want when you are standing at a roll with a knife.
 * One cut per line, each with the yardage it consumes, and the total — because
 * the total is what decides whether the roll on the floor is big enough.
 */
export function CutList({
  item,
}: {
  item: { cuts?: OrderCutRow[] | null; cut_notes?: string | null };
}) {
  const lines = cutLines(item);
  if (!lines.length) return null;
  const total = cutsTotalSqYd(item);

  return (
    <div className="mt-1.5 rounded-md bg-muted/50 px-2 py-1.5">
      <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Scissors className="size-3" />
        {lines.length === 1 ? "Cut" : `Cuts (${lines.length})`}
      </div>
      <ul className="space-y-0.5">
        {lines.map((c, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
            <span className="font-medium">{c.label}</span>
            {c.sqyd != null ? (
              <span className="text-xs text-muted-foreground">{c.sqyd} sq yd</span>
            ) : null}
          </li>
        ))}
      </ul>
      {total != null && lines.length > 1 ? (
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t pt-1 text-sm tabular-nums">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="font-semibold">{total} sq yd</span>
        </div>
      ) : null}
    </div>
  );
}

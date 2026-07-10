import { AlertTriangle } from "lucide-react";
import { reorderAlertsFor } from "@/lib/data/stock-rolls";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * NOTIFY-ONLY reorder alert. When a PO/order has line products we already hold a
 * usable remnant / leftover roll of, it warns "you already have X in [location]".
 * No quantity math, no auto-adjust — the buyer decides. Matched by product_id.
 * Renders nothing if there's nothing to flag.
 */
export async function ReorderAlerts({ productIds }: { productIds: string[] }) {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return null;
  let alerts: Awaited<ReturnType<typeof reorderAlertsFor>> = {};
  try {
    alerts = await reorderAlertsFor(ids, createAdminClient());
  } catch {
    alerts = await reorderAlertsFor(ids);
  }
  const list = Object.values(alerts);
  if (!list.length) return null;

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4" /> Already in stock — do you want to use it?
      </div>
      <ul className="space-y-1 text-sm">
        {list.map((a) => (
          <li key={a.productId} className="text-amber-900 dark:text-amber-200">
            You already have{" "}
            <span className="font-semibold tabular-nums">
              {a.totalQty} {a.unit}
            </span>{" "}
            {a.count > 1 ? `across ${a.count} pieces` : "as a remnant/roll"}
            {a.items.some((i) => i.location) ? (
              <span className="text-amber-700 dark:text-amber-300/90">
                {" "}
                · {a.items.filter((i) => i.location).map((i) => i.location).join(", ")}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-300/90"> · no location set yet</span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-amber-700 dark:text-amber-300/80">
        Heads-up only — your order isn&apos;t changed. Use the remnant or order as planned.
      </p>
    </div>
  );
}

import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import { buildCustomerScope } from "@/lib/customer-scope";
import { CustomerScopeView } from "@/components/customer-scope-view";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Estimate, EstimateOption } from "@/lib/types";

/**
 * The customer-facing SIDE-BY-SIDE option comparison. Each option is one clean
 * card: name (+ a "Recommended" badge when the owner flagged it), the full scope
 * in words (via CustomerScopeView — no quantities, units, cost, or margin), and
 * its own lump-sum price. Shared by the printed estimate and the portal so paper
 * and screen match. `renderAction` supplies a per-option approve button on the
 * portal; the print copy passes none.
 *
 * Firewall: the ONLY number shown per option is its lump-sum total.
 */
export function EstimateOptionCards({
  estimate,
  printMode = false,
  renderAction,
}: {
  estimate: Estimate;
  /** Print-safe styling (black text, no theme colors). */
  printMode?: boolean;
  renderAction?: (option: EstimateOption) => ReactNode;
}) {
  const options = estimate.options ?? [];
  const variant = estimate.presentation === "summary" ? "condensed" : "full";
  const cols = Math.min(options.length, 3);
  const gridCols =
    cols >= 3 ? "md:grid-cols-2 lg:grid-cols-3" : cols === 2 ? "md:grid-cols-2" : "";

  return (
    <div className={cn("grid gap-4", gridCols)}>
      {options.map((o) => {
        const lines = o.line_items ?? [];
        const totals = optionTotalsWithDiscount(
          lines,
          estimate.tax_rate,
          estimate.discount_kind,
          estimate.discount_value,
        );
        const scope = buildCustomerScope(lines, estimate.notes);
        const recommended = o.id === estimate.recommended_option_id;
        return (
          <div
            key={o.id}
            className={cn(
              "flex break-inside-avoid flex-col rounded-lg border p-4",
              printMode ? "border-gray-300 text-black" : "bg-card",
              recommended &&
                (printMode
                  ? "border-2 border-gray-800"
                  : "border-primary ring-1 ring-primary"),
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
              <div className="font-semibold">{o.name}</div>
              {recommended ? (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                    printMode ? "bg-gray-800 text-white" : "bg-primary/10 text-primary",
                  )}
                >
                  <Star className={cn("size-3", !printMode && "fill-primary")} />
                  Recommended
                </span>
              ) : null}
            </div>

            <div className="flex-1">
              <CustomerScopeView scope={scope} variant={variant} />
            </div>

            <div className="mt-3 flex items-baseline justify-between border-t pt-2">
              <span
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  printMode ? "text-gray-600" : "text-muted-foreground",
                )}
              >
                Total
              </span>
              <span className="text-xl font-bold tabular-nums">
                {formatMoney(totals.total)}
              </span>
            </div>

            {renderAction ? <div className="mt-3">{renderAction(o)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

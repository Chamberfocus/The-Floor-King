"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Building2, TriangleAlert, Archive } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/empty-state";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createPOsFromEstimateSelection } from "@/app/(app)/purchase-orders/actions";
import type { EstimateOrderPlan, OrderPlanLine } from "@/lib/data/po-plan";

const inputCls =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One selectable material row with a checkbox on the far left. */
function Row({
  line,
  checked,
  onToggle,
  right,
}: {
  line: OrderPlanLine;
  checked: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-t px-3 py-2 first:border-t-0">
      <input
        type="checkbox"
        className="size-4 shrink-0 accent-primary"
        checked={checked}
        onChange={onToggle}
        aria-label={`Order ${line.description}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{line.description}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {line.qty} {line.unit}
          {line.unitCost > 0 ? ` · ${formatMoney(line.unitCost)}/${line.unit}` : ""}
        </div>
      </div>
      {right ?? (
        <div className="shrink-0 text-sm font-medium tabular-nums">
          {line.lineTotal > 0 ? formatMoney(line.lineTotal) : "—"}
        </div>
      )}
    </div>
  );
}

export function OrderMaterials({ plan }: { plan: EstimateOrderPlan }) {
  // Default: order every resolved-vendor line whose company doesn't already have
  // a PO, plus every unassigned line. From-stock lines start unchecked.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const v of plan.vendors)
      if (!v.hasExistingPo) for (const l of v.lines) s.add(l.lineId);
    for (const l of plan.unassigned) s.add(l.lineId);
    return s;
  });
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Set<string>>(
    () => new Set(plan.unassigned.filter((l) => l.productId).map((l) => l.lineId)),
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleRemember = (id: string) =>
    setRemember((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const allLines = useMemo(
    () => [
      ...plan.vendors.flatMap((v) => v.lines),
      ...plan.unassigned,
      ...plan.fromStock,
    ],
    [plan],
  );
  const totalById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of allLines) m.set(l.lineId, l.lineTotal);
    return m;
  }, [allLines]);

  const checkedCount = selected.size;
  const checkedTotal = [...selected].reduce(
    (s, id) => s + (totalById.get(id) ?? 0),
    0,
  );

  const nothing =
    plan.vendors.length === 0 &&
    plan.unassigned.length === 0 &&
    plan.fromStock.length === 0;

  if (nothing) {
    return (
      <EmptyState
        icon={Boxes}
        title="No materials to order on this estimate"
        description="Only labor/services are on this estimate, or every material is already handled. Add material lines in the estimate builder."
      />
    );
  }

  return (
    <form action={createPOsFromEstimateSelection} className="space-y-4 pb-24">
      {/* Unassigned — pick a company for each. */}
      {plan.unassigned.length > 0 ? (
        <Card className="border-amber-300 dark:border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-600" /> No company set
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Pick which company to order each of these from. Leave blank and it
              goes on a “Special order” PO. Assigning here can be remembered on
              the product for next time.
            </p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {plan.unassigned.map((l) => (
              <Row
                key={l.lineId}
                line={l}
                checked={selected.has(l.lineId)}
                onToggle={() => toggle(l.lineId)}
                right={
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      className={inputCls}
                      value={assign[l.lineId] ?? ""}
                      onChange={(e) =>
                        setAssign((p) => ({ ...p, [l.lineId]: e.target.value }))
                      }
                    >
                      <option value="">Special order…</option>
                      {plan.suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {l.productId && assign[l.lineId] ? (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          className="size-3.5 accent-primary"
                          checked={remember.has(l.lineId)}
                          onChange={() => toggleRemember(l.lineId)}
                        />
                        remember
                      </label>
                    ) : null}
                  </div>
                }
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* One card per company → one PO. */}
      {plan.vendors.map((v) => {
        const sub = v.lines
          .filter((l) => selected.has(l.lineId))
          .reduce((s, l) => s + l.lineTotal, 0);
        return (
          <Card key={v.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <Building2 className="size-4 text-muted-foreground" /> {v.name}
                </span>
                {v.hasExistingPo ? (
                  <Link
                    href={`/purchase-orders/${v.existingPoId}`}
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:underline dark:bg-amber-950/50 dark:text-amber-300"
                  >
                    {v.existingPoDraft
                      ? "PO exists — checked items are added to it"
                      : "PO already ordered — checked items go on a new PO"}
                  </Link>
                ) : (
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {formatMoney(sub)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {v.lines.map((l) => (
                <Row
                  key={l.lineId}
                  line={l}
                  checked={selected.has(l.lineId)}
                  onToggle={() => toggle(l.lineId)}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* From stock — not ordered by default. */}
      {plan.fromStock.length > 0 ? (
        <Card className="bg-muted/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
              <Archive className="size-4" /> From stock — not ordered
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              These are set to pull from your stock. Check one to order it instead.
            </p>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {plan.fromStock.map((l) => (
              <Row
                key={l.lineId}
                line={l}
                checked={selected.has(l.lineId)}
                onToggle={() => toggle(l.lineId)}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {/* Hidden inputs carry the selection to the server action. */}
      <input type="hidden" name="estimate_id" value={plan.estimateId} />
      {[...selected].map((id) => (
        <input key={`l-${id}`} type="hidden" name="line" value={id} />
      ))}
      {plan.unassigned
        .filter((l) => selected.has(l.lineId) && assign[l.lineId])
        .map((l) => (
          <input
            key={`a-${l.lineId}`}
            type="hidden"
            name="assign"
            value={`${l.lineId}:${assign[l.lineId]}`}
          />
        ))}
      {plan.unassigned
        .filter(
          (l) =>
            selected.has(l.lineId) &&
            assign[l.lineId] &&
            l.productId &&
            remember.has(l.lineId),
        )
        .map((l) => (
          <input key={`p-${l.lineId}`} type="hidden" name="persist" value={l.lineId} />
        ))}

      {/* Sticky action bar. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="text-sm">
            <span className="font-semibold tabular-nums">{checkedCount}</span> item
            {checkedCount === 1 ? "" : "s"} ·{" "}
            <span className="font-semibold tabular-nums">
              {formatMoney(checkedTotal)}
            </span>
            <span className="ml-1 text-muted-foreground">— one PO per company</span>
          </div>
          <SubmitButton
            disabled={checkedCount === 0}
            pendingText="Creating…"
            confirm="Purchase orders created"
          >
            <Boxes className="size-4" /> Create purchase orders
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

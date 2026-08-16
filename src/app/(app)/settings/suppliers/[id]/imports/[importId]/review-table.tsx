"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { costSwing, isSafeToApply, type ImportLine } from "@/lib/data/supplier-feeds";
import { applyImport, discardImport } from "./actions";

/** Costs are held to 4 decimals — a per-sq-ft price rounded to cents is wrong. */
function money(n: number | null): string {
  if (n == null) return "—";
  const decimals = Math.abs(n) < 10 && Math.round(n * 100) !== n * 100 ? 4 : 2;
  return `$${n.toFixed(decimals)}`;
}

/** How many rows we draw at once. A mill's catalog is far longer than anyone reads. */
const RENDER_CAP = 400;

interface Flag {
  label: string;
  tone: "warn" | "info";
  title: string;
}

function flagsFor(l: ImportLine): Flag[] {
  const raw = (l.raw ?? {}) as Record<string, unknown>;
  const out: Flag[] = [];
  if (l.match_kind === "none")
    out.push({ label: "no match", tone: "info", title: "This SKU isn't in our catalog. Nothing to update." });
  if (raw.matched_other_supplier === true)
    out.push({
      label: "other supplier",
      tone: "warn",
      title: "The SKU matched a product attributed to a different supplier. Confirm it really is the same item before applying.",
    });
  if (raw.uom_mismatch === true)
    out.push({
      label: `their ${l.uom} vs our ${String(raw.product_unit ?? "?")}`,
      tone: "warn",
      title: "They price this in a different unit than we sell it in. Applying it as-is would be a multiplication error in our cost.",
    });
  if (raw.list_price === true)
    out.push({
      label: `list price (${String(raw.price_qualifier ?? "?")})`,
      tone: "warn",
      title: "This came from a list/retail qualifier, not a net cost. Loading it in as cost inflates every estimate built afterwards.",
    });
  if (l.new_cost == null)
    out.push({ label: "no price", tone: "info", title: "They sent the item but no usable price." });
  const covers = Number(raw.covers_products ?? 0);
  if (covers > 1)
    out.push({
      label: `1 of ${covers} on this SKU`,
      tone: "info",
      title: `This supplier prices by style, and ${covers} of our products share this number — usually colourways of the same carpet. Each gets its own line so you can see what every one of them costs today.`,
    });
  return out;
}

export function ReviewTable({
  supplierId,
  importId,
  lines,
  readOnly,
}: {
  supplierId: string;
  importId: string;
  lines: ImportLine[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [showAll, setShowAll] = useState(false);

  const safeIds = useMemo(
    () => lines.filter(isSafeToApply).map((l) => l.id),
    [lines],
  );
  const [selected, setSelected] = useState<Set<string>>(() => new Set(safeIds));

  // Changes first, then everything else — the whole point is what MOVED.
  const ordered = useMemo(() => {
    const changed = lines.filter((l) => l.product_id && l.new_cost != null && l.new_cost !== l.old_cost);
    const changedIds = new Set(changed.map((l) => l.id));
    const rest = lines.filter((l) => !changedIds.has(l.id));
    return { changed, rest, all: [...changed, ...rest] };
  }, [lines]);

  const visible = showAll ? ordered.all : ordered.changed;
  const drawn = visible.slice(0, RENDER_CAP);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = () =>
    start(async () => {
      const res = await applyImport(supplierId, importId, [...selected]);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${res.applied} price${res.applied === 1 ? "" : "s"} updated`);
      router.refresh();
    });

  const discard = () =>
    start(async () => {
      const res = await discardImport(supplierId, importId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Import discarded");
      router.refresh();
    });

  const risky = [...selected].filter((id) => {
    const l = lines.find((x) => x.id === id);
    return l && !isSafeToApply(l);
  }).length;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className={!showAll ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
          >
            Changes ({ordered.changed.length})
          </button>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={showAll ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
          >
            Everything ({lines.length})
          </button>
        </div>
        {!readOnly ? (
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(new Set(safeIds))}
            >
              Select the {safeIds.length} safe change{safeIds.length === 1 ? "" : "s"}
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          {drawn.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {showAll ? "This import had no lines." : "No price changed. Every matched item already costs what they say it does."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    {!readOnly ? <th className="w-10 p-2" /> : null}
                    <th className="p-2 text-left font-medium">Item</th>
                    <th className="p-2 text-right font-medium">Our cost</th>
                    <th className="p-2 text-right font-medium">Their price</th>
                    <th className="p-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {drawn.map((l) => {
                    const raw = (l.raw ?? {}) as Record<string, unknown>;
                    const swing = costSwing(l);
                    const flags = flagsFor(l);
                    const checked = selected.has(l.id);
                    const canPick = l.product_id != null && l.new_cost != null;
                    return (
                      <tr key={l.id} className={l.applied ? "bg-emerald-50/50 dark:bg-emerald-950/20" : undefined}>
                        {!readOnly ? (
                          <td className="p-2 align-top">
                            <input
                              type="checkbox"
                              className="mt-1 size-4 rounded border-input"
                              checked={checked}
                              disabled={!canPick}
                              onChange={() => toggle(l.id)}
                              aria-label={`Apply ${l.supplier_sku ?? "line"}`}
                            />
                          </td>
                        ) : null}
                        <td className="p-2 align-top">
                          <div className="font-medium">
                            {(raw.product_name as string) ?? l.description ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <span className="font-mono">{l.supplier_sku}</span>
                            {l.uom ? ` · per ${l.uom}` : ""}
                            {raw.price_qualifier ? ` · ${String(raw.price_qualifier)}` : ""}
                          </div>
                          {flags.length ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {flags.map((f) => (
                                <span
                                  key={f.label}
                                  title={f.title}
                                  className={
                                    f.tone === "warn"
                                      ? "inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      : "inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                                  }
                                >
                                  {f.tone === "warn" ? <AlertTriangle className="size-3" /> : null}
                                  {f.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-2 text-right align-top tabular-nums text-muted-foreground">
                          {money(l.old_cost)}
                        </td>
                        <td className="p-2 text-right align-top font-medium tabular-nums">
                          {money(l.new_cost)}
                        </td>
                        <td className="p-2 text-right align-top tabular-nums">
                          {swing == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={
                                swing > 0.05
                                  ? "font-semibold text-destructive"
                                  : swing > 0
                                    ? "text-destructive"
                                    : swing < 0
                                      ? "text-emerald-600"
                                      : "text-muted-foreground"
                              }
                            >
                              {swing > 0 ? "+" : ""}
                              {(swing * 100).toFixed(1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {visible.length > drawn.length ? (
            <p className="border-t p-3 text-center text-xs text-muted-foreground">
              Showing the first {drawn.length} of {visible.length}. The rest are still in this
              import and are included when you apply.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {!readOnly ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {selected.size} selected
            {risky ? (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                {risky} of them flagged
              </span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={discard}>
              <Trash2 className="size-4" /> Discard
            </Button>
            <Button type="button" disabled={busy || selected.size === 0} onClick={apply}>
              <Check className="size-4" />
              {busy ? "Applying…" : `Apply ${selected.size} price${selected.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      ) : null}

      {!readOnly && ordered.changed.length > 0 ? (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <ArrowRight className="mt-0.5 size-3.5 shrink-0" />
          Applying updates the product&apos;s cost only. Estimates already written keep the cost
          they were built with — they are re-priced only if someone re-picks the product.
        </p>
      ) : null}
    </>
  );
}

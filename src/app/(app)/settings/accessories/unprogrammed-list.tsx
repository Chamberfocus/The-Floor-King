"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import type { UnprogrammedRow } from "@/lib/data/accessories";

const SHOW = 20;

/**
 * Trim items that no program owns, and why. These stay exactly as they are —
 * real, searchable, orderable products. They are listed here so nothing is
 * silently dropped: a wrong guess would mis-price a real item, so the ones that
 * can't be read cleanly are surfaced rather than forced into a program.
 */
export function UnprogrammedList({ rows }: { rows: UnprogrammedRow[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(SHOW);

  const byReason = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      [r.product.name, r.product.manufacturer, r.product.color, r.reason]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(term)),
    );
  }, [rows, q]);

  if (!rows.length) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
          <div className="flex-1">
            <CardTitle>
              Unprogrammed accessories ({rows.length.toLocaleString()})
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Still real, searchable products — just not in a program. Nothing was
              deleted or changed.
            </p>
          </div>
        </button>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">Why they were left out</div>
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              {byReason.map(([reason, n]) => (
                <li key={reason}>
                  <span className="font-medium tabular-nums text-foreground">
                    {n.toLocaleString()}
                  </span>{" "}
                  — {reason}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setLimit(SHOW);
              }}
              placeholder="Search these items…"
              className="pl-8"
            />
          </div>

          <div className="divide-y">
            {filtered.slice(0, limit).map(({ product, reason }) => (
              <div key={product.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/catalog/${product.id}`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {product.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {[product.manufacturer, product.color].filter(Boolean).join(" · ") ||
                      "—"}
                  </div>
                </div>
                <Badge variant="secondary" className="hidden font-normal sm:inline-flex">
                  {reason}
                </Badge>
                <div className="w-24 shrink-0 text-right text-sm tabular-nums">
                  {formatMoney(product.material_rate)}
                  <span className="text-xs text-muted-foreground">
                    /{product.unit}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {filtered.length > limit && (
            <div className="text-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((n) => n + 50)}
              >
                Show more ({(filtered.length - limit).toLocaleString()} more)
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

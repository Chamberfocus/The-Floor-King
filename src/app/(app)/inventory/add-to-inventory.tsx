"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";
import { startTracking, searchUntrackedProducts } from "./actions";

export function AddToInventoryForm() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [picked, setPicked] = useState<Product | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      setResults(await searchUntrackedProducts(q));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  return (
    <form action={startTracking} className="flex flex-wrap items-end gap-2">
      <div ref={boxRef} className="relative">
        <label className="mb-1 block text-xs text-muted-foreground">Product</label>
        <input type="hidden" name="product_id" value={picked?.id ?? ""} required />
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={picked ? productLabel(picked) : q}
            onChange={(e) => {
              setPicked(null);
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={(e) => {
              setOpen(true);
              e.currentTarget.select();
            }}
            placeholder="Search a product to track…"
            className="h-9 w-72 rounded-md border border-input bg-transparent pl-8 pr-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {open ? (
          <div className="absolute z-30 mt-1 max-h-64 w-80 overflow-y-auto rounded-md border bg-popover py-1 shadow-lg">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No untracked products match.
              </p>
            ) : (
              results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPicked(p);
                    setOpen(false);
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-left text-sm hover:bg-muted/60",
                  )}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[p.manufacturer, p.sku ? `#${p.sku}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Opening count</label>
        <Input name="on_hand" type="number" step="0.01" min="0" defaultValue="0" className="w-24" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Reorder at</label>
        <Input name="reorder_point" type="number" step="0.01" min="0" defaultValue="0" className="w-24" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Bin</label>
        <Input name="bin_location" placeholder="A-12" className="w-28" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">In stock since</label>
        <Input name="stocked_since" type="date" className="w-36" />
      </div>
      <Button type="submit" disabled={!picked}>
        Track
      </Button>
    </form>
  );
}

function productLabel(p: Product): string {
  return [p.manufacturer, p.name].filter(Boolean).join(" ");
}

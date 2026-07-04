"use client";

import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { PRICE_BOOK, type PriceItem } from "@/lib/price-book";

/**
 * "Add from price list" — opens the Floor King price book, lets you search and
 * tap an item; it's handed back to the builder with its cost prefilled. Used by
 * every estimate builder so the real company prices are one tap away.
 */
export function PriceBookPicker({
  onPick,
  triggerLabel = "Price list",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
}: {
  onPick: (item: PriceItem) => void;
  triggerLabel?: string;
  triggerVariant?: "outline" | "ghost" | "default";
  triggerSize?: "sm" | "default" | "lg" | "icon-sm";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return PRICE_BOOK;
    return PRICE_BOOK.map((g) => ({
      ...g,
      items: g.items.filter(
        (it) => it.label.toLowerCase().includes(term) || g.group.toLowerCase().includes(term),
      ),
    })).filter((g) => g.items.length);
  }, [q]);

  const pick = (it: PriceItem) => {
    onPick(it);
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <BookOpen className="size-3.5" /> {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Price list</DialogTitle>
            <DialogDescription>
              Tap an item to add it — the cost drops in and marks up to your
              margin. You can still adjust the price on the line.
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search — e.g. stairnose, demo, padding, J-channel"
              className="pl-8"
              autoFocus
            />
          </div>

          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.group}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.group}
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  {g.items.map((it) => (
                    <button
                      key={it.label}
                      type="button"
                      onClick={() => pick(it)}
                      className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm hover:border-primary hover:bg-primary/5"
                    >
                      <span className="min-w-0 truncate">
                        {it.label}
                        <span
                          className={cn(
                            "ml-1 text-xs uppercase",
                            it.labor ? "text-amber-600" : "text-muted-foreground",
                          )}
                        >
                          {it.labor ? "labor" : it.unit}
                        </span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatMoney(it.cost)}
                        <span className="text-xs text-muted-foreground">/{it.unit}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No price-list item matches “{q}”.
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

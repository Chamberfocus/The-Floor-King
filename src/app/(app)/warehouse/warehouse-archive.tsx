"use client";

import { useState, type ReactNode } from "react";
import { Archive, ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ArchiveItem {
  id: string;
  /** Lowercased haystack: customer, title, address, staging location, crew. */
  search: string;
  node: ReactNode;
}

/**
 * Staged jobs are done with active prep, so they're tucked into this collapsed
 * archive to keep the warehouse queue clean — but stay fully searchable (by
 * customer, address, or staging location) for when the warehouse needs to look
 * one up later.
 */
export function WarehouseArchive({ items }: { items: ArchiveItem[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query
    ? items.filter((i) => i.search.includes(query))
    : items;

  if (!items.length) return null;

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-t pt-4 text-sm font-semibold text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
        <Archive className="size-4" />
        Staged &amp; archived ({items.length})
      </button>

      {open ? (
        <div className="mt-3 space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search staged jobs — customer, address, staging location…"
              className="pl-8"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No staged jobs match “{q}”.
            </p>
          ) : (
            <div className="space-y-4">
              {filtered.map((i) => (
                <div key={i.id}>{i.node}</div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

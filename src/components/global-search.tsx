"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search, Users, FileText, Receipt, ShoppingCart, Wrench, Package, ArrowRight, Loader2,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { quickSearch, type HitType, type QuickHit } from "@/app/(app)/search/actions";

const ICON: Record<HitType, LucideIcon> = {
  customer: Users,
  estimate: FileText,
  invoice: Receipt,
  po: ShoppingCart,
  job: Wrench,
  product: Package,
};

export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<{ type: HitType; label: string; hits: QuickHit[] }[]>([]);
  const [filter, setFilter] = useState<HitType | "all">("all");
  const [active, setActive] = useState(0);
  const [pending, startSearch] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);
  const reqRef = useRef(0);

  // Debounced live search as you type.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGroups([]);
      return;
    }
    const id = ++reqRef.current;
    const t = setTimeout(() => {
      startSearch(async () => {
        const res = await quickSearch(term, 6);
        if (id !== reqRef.current) return; // a newer keystroke won
        setGroups(res.groups);
        setFilter("all");
        setActive(0);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Type filter chips — only for types that actually have hits.
  const chips = useMemo(
    () => groups.map((g) => ({ type: g.type, label: g.label, n: g.hits.length })),
    [groups],
  );
  const shownGroups = useMemo(
    () => (filter === "all" ? groups : groups.filter((g) => g.type === filter)),
    [groups, filter],
  );
  // Flat list for keyboard nav.
  const flat = useMemo(() => shownGroups.flatMap((g) => g.hits), [shownGroups]);

  const go = (hit: QuickHit) => {
    setOpen(false);
    setQ("");
    setGroups([]);
    router.push(hit.href);
  };
  const seeAll = () => {
    const term = q.trim();
    if (term.length < 2) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && flat[active]) go(flat[active]);
      else seeAll();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Search customers, estimates, invoices, POs, work orders…"
          aria-label="Search the CRM"
          className="pl-9"
        />
        {pending ? (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {showPanel ? (
        <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {/* Type filter chips */}
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-1 border-b p-2">
              <Chip on={filter === "all"} onClick={() => setFilter("all")}>
                All
              </Chip>
              {chips.map((c) => (
                <Chip key={c.type} on={filter === c.type} onClick={() => setFilter(c.type)}>
                  {c.label} <span className="opacity-60">{c.n}</span>
                </Chip>
              ))}
            </div>
          ) : null}

          <div className="max-h-[60vh] overflow-y-auto py-1">
            {flat.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {pending ? "Searching…" : `No matches for “${q.trim()}”`}
              </div>
            ) : (
              shownGroups.map((g) => {
                const Icon = ICON[g.type];
                return (
                  <div key={g.type}>
                    <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label}
                    </div>
                    {g.hits.map((hit) => {
                      const idx = flat.indexOf(hit);
                      return (
                        <button
                          key={`${hit.type}-${hit.id}`}
                          type="button"
                          onMouseEnter={() => setActive(idx)}
                          onClick={() => go(hit)}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm",
                            idx === active ? "bg-accent" : "hover:bg-accent/50",
                          )}
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{hit.title}</span>
                            {hit.subtitle ? (
                              <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* See-all footer */}
          <button
            type="button"
            onClick={seeAll}
            className="flex w-full items-center justify-between gap-2 border-t px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50"
          >
            <span>See all results for “{q.trim()}”</span>
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
        on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

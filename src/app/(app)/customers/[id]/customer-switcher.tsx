"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchCustomers } from "../actions";

type Hit = { id: string; name: string; hint: string | null };

/**
 * Jump straight to another customer's file without going back to the list —
 * type a name/phone/email and pick. Skips the current customer in results.
 */
export function CustomerSwitcher({ currentId }: { currentId: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Hit[]>([]);
  const [pending, startTransition] = useTransition();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      startTransition(async () => {
        // searchCustomers returns [] for queries under 2 chars, so an empty/short
        // box clears results without a synchronous setState in the effect body.
        const rows = await searchCustomers(q.trim());
        setResults(rows.filter((r) => r.id !== currentId));
      });
    }, 200);
    return () => clearTimeout(t);
  }, [q, currentId]);

  const go = (id: string) => {
    setOpen(false);
    setQ("");
    router.push(`/customers/${id}`);
  };

  return (
    <div ref={boxRef} className="relative w-full sm:w-64">
      <div className="relative">
        {pending ? (
          <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        )}
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Jump to another customer…"
          className="h-9 pl-8"
        />
      </div>
      {open && results.length > 0 ? (
        <div className="absolute z-40 mt-1 max-h-64 w-full min-w-64 overflow-auto rounded-md border bg-popover shadow-lg">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => go(c.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="truncate font-medium">{c.name}</span>
              {c.hint ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.hint}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

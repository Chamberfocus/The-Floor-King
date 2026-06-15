"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchCustomersForBooking, type CustomerHit } from "./actions";

export function CustomerSearch({
  onPick,
}: {
  onPick: (c: CustomerHit | null) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [picked, setPicked] = useState<CustomerHit | null>(null);
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
    if (picked) return;
    const t = setTimeout(async () => {
      setResults(await searchCustomersForBooking(q));
    }, 200);
    return () => clearTimeout(t);
  }, [q, picked]);

  if (picked) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div>
          <span className="font-medium">{picked.name}</span>
          {picked.phone ? (
            <span className="ml-2 text-muted-foreground">{picked.phone}</span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setPicked(null);
            setQ("");
            onPick(null);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search existing customers…"
          className="pl-9"
        />
      </div>
      {open && results.length > 0 ? (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover shadow-md">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setPicked(c);
                setOpen(false);
                onPick(c);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <span className="font-medium">{c.name}</span>
              <span className="ml-2 text-muted-foreground">
                {c.phone ?? c.email ?? c.address ?? ""}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

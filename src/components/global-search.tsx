"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(
    pathname === "/search" ? sp.get("q") ?? "" : "",
  );

  return (
    <form
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (v.length >= 2) router.push(`/search?q=${encodeURIComponent(v)}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search customers, styles, colors, item #, manufacturer…"
        aria-label="Search the CRM"
        className="pl-9"
      />
    </form>
  );
}

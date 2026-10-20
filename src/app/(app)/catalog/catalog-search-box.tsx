"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Catalog search that runs as you type. One word of a name, a color, a brand,
 * or a SKU is enough — the server ranks the matches.
 */
export function CatalogSearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  useEffect(() => {
    const term = q.trim();
    if (term === initial.trim()) return;
    if (term.length === 1) return;
    const t = setTimeout(() => {
      router.replace(term ? `/catalog?q=${encodeURIComponent(term)}` : "/catalog", { scroll: false });
    }, 220);
    return () => clearTimeout(t);
  }, [q, initial, router]);

  return (
    <form
      className="mb-4 flex max-w-xl gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.replace(term ? `/catalog?q=${encodeURIComponent(term)}` : "/catalog", { scroll: false });
      }}
    >
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, color, brand, or SKU — typos are ok"
          aria-label="Search the catalog"
          className="pl-9"
        />
      </div>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}

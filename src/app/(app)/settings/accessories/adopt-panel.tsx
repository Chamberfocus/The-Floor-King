"use client";

import { useState, useTransition } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { adoptExistingTrim } from "./actions";
import type { AdoptReport } from "@/lib/accessory-engine";

/**
 * Take over the vendor trim rows already in the catalog. Purely additive — it
 * reads the type out of each name and records the grouping. It never deletes,
 * deactivates, renames, or re-prices a vendor row.
 *
 * Adoption is scoped to the brands you tick, because a derivation you cannot
 * review is a derivation you cannot trust: check it on brands you know cold
 * before letting it loose on the rest of the catalog.
 */
export function AdoptPanel({
  brands,
  trimTotal,
  alreadyAdopted,
}: {
  brands: { manufacturer: string; rows: number }[];
  trimTotal: number;
  alreadyAdopted: number;
}) {
  const [pending, start] = useTransition();
  const [report, setReport] = useState<AdoptReport | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const adoptable = brands.reduce((n, b) => n + b.rows, 0);
  const pickedRows = brands
    .filter((b) => picked.has(b.manufacturer))
    .reduce((n, b) => n + b.rows, 0);

  const toggle = (m: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });

  const run = (all: boolean) =>
    start(async () => {
      const r = await adoptExistingTrim(all ? undefined : [...picked]);
      setReport(r);
      if (r.error) toast.error(r.error);
      else
        toast.success(
          `Adopted ${r.adopted.toLocaleString()} items into ${r.programs.toLocaleString()} programs.`,
        );
      setPicked(new Set());
    });

  if (!adoptable) {
    return (
      <Card className="mb-6">
        <CardContent className="p-4 text-sm">
          <span className="font-medium">
            {alreadyAdopted.toLocaleString()} vendor items adopted
          </span>
          <span className="text-muted-foreground">
            {" "}
            of {trimTotal.toLocaleString()} trim rows. Nothing left to adopt.
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6 border-amber-300 dark:border-amber-800">
      <CardContent className="space-y-4 p-4">
        <div className="flex gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
          <div className="text-sm">
            <div className="font-medium">
              {adoptable.toLocaleString()} imported trim items can be adopted
            </div>
            <p className="mt-1 max-w-2xl text-muted-foreground">
              Reads the type out of each vendor name, groups them by manufacturer
              + line, and records the price the vendor actually charges. Your rows
              are <strong>not</strong> deleted, renamed, or re-priced — only
              tagged. Anything that doesn&apos;t parse cleanly is left alone and
              listed below.
            </p>
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium">
            Pick the brands to adopt — start with ones you know
          </div>
          <div className="flex flex-wrap gap-1.5">
            {brands.slice(0, 24).map((b) => (
              <button
                key={b.manufacturer}
                type="button"
                onClick={() => toggle(b.manufacturer)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  picked.has(b.manufacturer)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:border-primary hover:bg-primary/5"
                }`}
              >
                {b.manufacturer}{" "}
                <span className="opacity-60 tabular-nums">{b.rows}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            {picked.size
              ? `${picked.size} brand${picked.size === 1 ? "" : "s"} · ${pickedRows.toLocaleString()} items`
              : "Nothing selected."}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => run(true)}
              disabled={pending}
            >
              {pending ? "Adopting…" : "Adopt all brands"}
            </Button>
            <Button
              onClick={() => run(false)}
              disabled={pending || !picked.size}
            >
              {pending
                ? "Adopting…"
                : `Adopt ${pickedRows ? pickedRows.toLocaleString() : ""} selected`}
            </Button>
          </div>
        </div>

        {report && !report.error && (
          <div className="space-y-3 border-t pt-4 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <Fact label="Scanned" value={report.scanned} />
              <Fact label="Adopted" value={report.adopted} />
              <Fact label="Programs" value={report.programs} />
              <Fact label="Types" value={report.types} />
              <Fact label="Price overrides" value={report.overrides} />
            </div>
            {report.overrides > 0 && (
              <p className="text-xs text-muted-foreground">
                {report.overrides.toLocaleString()} colors cost something
                different from the rest of their type. Each keeps its real vendor
                price as an override rather than being flattened to the base.
              </p>
            )}
            {Object.keys(report.skipped).length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-4 text-amber-600 dark:text-amber-500" />
                  Left alone — not forced into a program
                </div>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {Object.entries(report.skipped)
                    .sort((a, b) => b[1] - a[1])
                    .map(([why, n]) => (
                      <li key={why}>
                        <span className="font-medium tabular-nums text-foreground">
                          {n.toLocaleString()}
                        </span>{" "}
                        — {why}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}

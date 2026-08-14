"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, FileText, Copy, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { formatDate } from "@/lib/format";
import {
  searchCustomersForCopy,
  customerWorkContext,
  duplicateEstimateToCustomer,
} from "./actions";
import { EstimateSourceGate } from "../customers/[id]/estimate-source-gate";
import type { LeadSourceRow, EstimateStatus } from "@/lib/types";

/**
 * Start the next piece of work, without going to the customer list.
 *
 * This page used to be a dropdown and a single "Build estimate" button that
 * dropped you into the raw builder — even though its own description promised
 * "the Wizard or a Quick estimate". Two things it got wrong beyond that:
 *
 *  • It pre-selected the FIRST customer, so pressing the button without
 *    touching the picker quietly started an estimate for the wrong person.
 *  • createEstimate refuses a customer with no recorded lead source and
 *    redirects to their file with no explanation. 11 of 40 live customers hit
 *    that — you press the button and get thrown somewhere else.
 *
 * Now: find them, then pick how to start. Repeat work — another room, the next
 * unit — copies what you already quoted instead of rebuilding it.
 */
export function StartEstimate({ sources }: { sources: LeadSourceRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; city: string | null }[]
  >([]);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof customerWorkContext>> | null>(
    null,
  );
  const [pending, start] = useTransition();

  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      const rows = await searchCustomersForCopy(q);
      if (active) setResults(rows);
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  const choose = (c: { id: string; name: string }) => {
    setChosen(c);
    setCtx(null);
    customerWorkContext(c.id).then(setCtx);
  };

  const copy = (estimateId: string) =>
    start(async () => {
      if (!chosen) return;
      const res = await duplicateEstimateToCustomer(estimateId, chosen.id, {});
      if (res.error || !res.estimateId) {
        toast.error(res.error ?? "Couldn't copy that estimate.");
        return;
      }
      toast.success("Copied — edit the new draft");
      router.push(`/estimates/${res.estimateId}/edit`);
    });

  if (!chosen) {
    return (
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a customer by name or city…"
            className="pl-8"
          />
        </div>
        <div className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {q ? "No matches." : "Start typing, or pick from your most recent below."}
            </p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => choose({ id: c.id, name: c.name })}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">{c.name}</span>
                {c.city ? (
                  <span className="text-xs text-muted-foreground">{c.city}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <Link
          href="/customers/new"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <UserPlus className="size-4" /> New customer instead
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span>
          Work for <span className="font-semibold">{chosen.name}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            setChosen(null);
            setCtx(null);
          }}
          className="text-xs font-medium text-primary hover:underline"
        >
          Change
        </button>
      </div>

      <div>
        <div className="mb-2 text-sm font-medium">Start a new estimate</div>
        {/* Same control the customer file uses: both ways in, and it captures a
            missing lead source inline instead of bouncing you elsewhere. */}
        {ctx ? (
          <EstimateSourceGate
            customerId={chosen.id}
            sourceOk={ctx.sourceOk}
            sources={sources}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </div>

      {/* Repeat work is the normal case. Copying what you already quoted beats
          rebuilding it from nothing. */}
      {ctx?.estimates.length ? (
        <div>
          <div className="mb-2 text-sm font-medium">
            Or copy what you quoted before
          </div>
          <ul className="divide-y rounded-md border">
            {ctx.estimates.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <Link
                      href={`/estimates/${e.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {e.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(e.createdAt)}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <EstimateStatusBadge status={e.status as EstimateStatus} />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => copy(e.id)}
                  >
                    <Copy className="size-3.5" /> Copy
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            A copy brings every room, option and price across as a fresh draft —
            and you can point it at a different address once it opens.
          </p>
        </div>
      ) : null}
    </div>
  );
}

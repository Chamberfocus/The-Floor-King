"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  searchCustomersForCopy,
  duplicateEstimateToCustomer,
} from "../actions";

/** "Copy to a new estimate" — pick (or search) the client to copy it onto. */
export function CopyEstimate({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<
    { id: string; name: string; city: string | null }[]
  >([]);
  const [pending, start] = useTransition();

  // Live customer search while the dialog is open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const t = setTimeout(async () => {
      const rows = await searchCustomersForCopy(q);
      if (active) setResults(rows);
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const pick = (customerId: string) =>
    start(async () => {
      const res = await duplicateEstimateToCustomer(estimateId, customerId);
      if (res.error || !res.estimateId) {
        toast.error(res.error || "Couldn't copy the estimate.");
        return;
      }
      setOpen(false);
      router.push(`/estimates/${res.estimateId}/edit`);
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" size="lg" />}
      >
        <Copy className="size-4" /> Copy to new estimate
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy to a new estimate</DialogTitle>
        </DialogHeader>
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
          <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
            {results.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                {q ? "No matches." : "Start typing to find a customer."}
              </p>
            ) : (
              results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={pending}
                  onClick={() => pick(c.id)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span className="font-medium">{c.name}</span>
                  {c.city ? (
                    <span className="text-xs text-muted-foreground">{c.city}</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Makes a fresh draft for the client you pick — every room, option, and
            price copied over.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

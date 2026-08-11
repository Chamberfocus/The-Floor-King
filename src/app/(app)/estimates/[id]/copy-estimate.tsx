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
  serviceAddressesForCustomer,
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
  /**
   * Step two: WHERE the work happens.
   *
   * A copy is nearly always the same scope at a different property — the
   * landlord's next unit, the builder's next lot. Copying straight through
   * inherited the customer's billing address, which is how a crew ends up at
   * the wrong door.
   */
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [saved, setSaved] = useState<
    { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null }[]
  >([]);
  const [addrId, setAddrId] = useState<string>("");
  const [addr, setAddr] = useState({ label: "", street: "", city: "", state: "", zip: "" });

  const reset = () => {
    setChosen(null); setSaved([]); setAddrId(""); setQ("");
    setAddr({ label: "", street: "", city: "", state: "", zip: "" });
  };

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

  const choose = (c: { id: string; name: string }) =>
    start(async () => {
      setChosen(c);
      setSaved(await serviceAddressesForCustomer(c.id));
    });

  const go = () =>
    start(async () => {
      if (!chosen) return;
      const res = await duplicateEstimateToCustomer(estimateId, chosen.id, {
        serviceAddressId: addrId || null,
        newAddress: addrId ? null : addr,
      });
      if (res.error || !res.estimateId) {
        toast.error(res.error || "Couldn't copy the estimate.");
        return;
      }
      setOpen(false);
      reset();
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
        {!chosen ? (
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
                    onClick={() => choose({ id: c.id, name: c.name })}
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
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span>
                Copying to <span className="font-semibold">{chosen.name}</span>
              </span>
              <button
                type="button"
                onClick={reset}
                className="text-xs font-medium text-primary hover:underline"
              >
                Change
              </button>
            </div>

            <div className="text-sm font-medium">Where is the work?</div>

            {saved.length ? (
              <div className="divide-y rounded-md border">
                {saved.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAddrId(addrId === a.id ? "" : a.id)}
                    className={
                      addrId === a.id
                        ? "flex w-full items-start gap-2 bg-primary/10 px-3 py-2 text-left text-sm"
                        : "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    }
                  >
                    <span className="min-w-0">
                      {a.label ? (
                        <span className="font-medium">{a.label} — </span>
                      ) : null}
                      {[a.street, [a.city, a.state].filter(Boolean).join(", "), a.zip]
                        .filter(Boolean)
                        .join(", ") || "(no address)"}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {!addrId ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  {saved.length
                    ? "Or type a new one — it's saved on the customer for next time."
                    : "Type the property address. It's saved on the customer for next time."}
                </p>
                <Input
                  value={addr.label}
                  onChange={(e) => setAddr({ ...addr, label: e.target.value })}
                  placeholder="Name it — e.g. Unit 4B, Lot 12 (optional)"
                />
                <Input
                  value={addr.street}
                  onChange={(e) => setAddr({ ...addr, street: e.target.value })}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    value={addr.city}
                    onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                    placeholder="City"
                  />
                  <Input
                    value={addr.state}
                    onChange={(e) => setAddr({ ...addr, state: e.target.value })}
                    placeholder="State"
                  />
                  <Input
                    value={addr.zip}
                    onChange={(e) => setAddr({ ...addr, zip: e.target.value })}
                    placeholder="ZIP"
                  />
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                Back
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={go}>
                {pending ? "Copying…" : "Copy the estimate"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave the address blank to use the customer&apos;s own address.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

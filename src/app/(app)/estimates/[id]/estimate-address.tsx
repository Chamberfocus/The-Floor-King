"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { serviceAddressesForCustomer, setEstimateAddress } from "../actions";

type Addr = {
  id: string;
  label: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export function formatAddr(a: {
  label?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const line = [a.street, [a.city, a.state].filter(Boolean).join(", "), a.zip]
    .filter(Boolean)
    .join(", ");
  return a.label ? (line ? `${a.label} — ${line}` : a.label) : line;
}

/**
 * Which property this estimate is for, and a way to change it.
 *
 * On a landlord or builder account every estimate is for the same customer but
 * a different unit, and the address could only ever be set at creation — pick
 * the wrong one and the only way back was to rebuild the estimate. It also
 * wasn't shown anywhere, so a wrong one was invisible until a crew turned up at
 * the wrong door.
 */
export function EstimateAddress({
  estimateId,
  customerId,
  current,
  billingAddress,
}: {
  estimateId: string;
  customerId: string;
  current: Addr | null;
  /** The account's own address — what the estimate falls back to. */
  billingAddress: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Addr[]>([]);
  const [addrId, setAddrId] = useState<string>(current?.id ?? "");
  const [addr, setAddr] = useState({ label: "", street: "", city: "", state: "", zip: "" });
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let active = true;
    serviceAddressesForCustomer(customerId).then((rows) => {
      if (active) setSaved(rows);
    });
    return () => {
      active = false;
    };
  }, [open, customerId]);

  const save = () =>
    start(async () => {
      const res = await setEstimateAddress(estimateId, {
        serviceAddressId: addrId || null,
        newAddress: addrId ? null : addr,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Job site updated");
      setOpen(false);
      setAddr({ label: "", street: "", city: "", state: "", zip: "" });
      router.refresh();
    });

  const typed = addr.street.trim() || addr.label.trim();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group inline-flex max-w-full items-start gap-1.5 rounded-md border border-dashed px-2.5 py-1.5 text-left text-sm hover:border-primary hover:bg-muted/50"
      >
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Job site
          </span>
          <span className="block break-words">
            {current ? (
              formatAddr(current)
            ) : (
              <span className="text-muted-foreground">
                {billingAddress || "Not set"} (account address)
              </span>
            )}
          </span>
        </span>
        <Pencil className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Where is the work?</DialogTitle>
            <DialogDescription>
              Changing this also re-points any work order already made from this
              estimate, so the crew and the warehouse get the right address.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {saved.length ? (
              <div className="divide-y rounded-md border">
                <button
                  type="button"
                  onClick={() => setAddrId("")}
                  className={
                    addrId === ""
                      ? "flex w-full items-start gap-2 bg-primary/10 px-3 py-2 text-left text-sm"
                      : "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  }
                >
                  <span className="min-w-0 text-muted-foreground">
                    Use the account address{billingAddress ? ` — ${billingAddress}` : ""}
                  </span>
                </button>
                {saved.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAddrId(a.id)}
                    className={
                      addrId === a.id
                        ? "flex w-full items-start gap-2 bg-primary/10 px-3 py-2 text-left text-sm"
                        : "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    }
                  >
                    <span className="min-w-0 break-words">
                      {formatAddr(a) || "(no address)"}
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
                  placeholder="Street"
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

            <Button
              type="button"
              className="w-full"
              disabled={pending || (!addrId && !typed && !current)}
              onClick={save}
            >
              {pending ? "Saving…" : "Save job site"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

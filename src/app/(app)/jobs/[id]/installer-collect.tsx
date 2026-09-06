"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wallet, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import { collectJobBalance } from "../actions";

type Method = "cash" | "check" | "link";

export function InstallerCollect({
  jobId,
  hasInvoice,
  balance,
}: {
  jobId: string;
  hasInvoice: boolean;
  balance: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("cash");
  const [reference, setReference] = useState("");

  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("job_id", jobId);
      fd.set("method", method);
      if (method === "check") fd.set("reference", reference.trim());
      try {
        await collectJobBalance(fd);
        setOpen(false);
        setReference("");
        toast.success(
          method === "link"
            ? "Office notified to send a payment link"
            : "Payment recorded — office notified",
        );
        router.refresh();
      } catch (e) {
        toast.error(
          e instanceof Error ? e.message : "Could not record payment.",
        );
      }
    });

  return (
    <Card className="mb-6 border-emerald-300 dark:border-emerald-900/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Wallet className="size-4" /> Collect payment
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasInvoice ? (
          <p className="text-sm text-muted-foreground">
            No invoice yet — the office needs to create the invoice before you can
            collect on this job.
          </p>
        ) : balance <= 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-4" /> Paid in full — nothing to collect.
          </p>
        ) : (
          <>
            <div className="mb-3">
              <div className="text-xs text-muted-foreground">Balance due</div>
              <div className="text-2xl font-bold">{formatMoney(balance)}</div>
            </div>
            <Button size="lg" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
              <Wallet className="size-4" /> Collect {formatMoney(balance)}
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Collect {formatMoney(balance)}?</DialogTitle>
                  <DialogDescription>
                    {method === "link"
                      ? "This asks the office to send the customer an online payment link — it does not record a payment now."
                      : `This records a ${formatMoney(balance)} ${method} payment, marks the invoice paid, and notifies the office.`}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div>
                    <Label>How are they paying?</Label>
                    <div className="mt-1.5 grid grid-cols-3 gap-2">
                      {(
                        [
                          ["cash", "Cash"],
                          ["check", "Check"],
                          ["link", "Pay online"],
                        ] as [Method, string][]
                      ).map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMethod(m)}
                          className={`rounded-md border px-2 py-2 text-sm ${
                            method === m
                              ? "border-primary bg-primary/10 font-medium"
                              : "hover:bg-muted"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {method === "check" ? (
                    <div>
                      <Label htmlFor="chk">Check # (optional)</Label>
                      <Input
                        id="chk"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder="e.g. 1042"
                        className="mt-1"
                      />
                    </div>
                  ) : null}

                  {method === "link" ? (
                    <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                      This does <strong>not</strong> take money now — it tells the
                      office to send {`the customer`} an online payment link for the
                      balance.
                    </p>
                  ) : null}
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" disabled={pending} onClick={submit}>
                    {pending
                      ? "Saving…"
                      : method === "link"
                        ? "Request online payment"
                        : `Record ${formatMoney(balance)}`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}

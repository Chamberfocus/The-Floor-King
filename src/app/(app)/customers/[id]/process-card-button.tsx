"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordCardPayment } from "@/app/(app)/invoices/actions";
import { formatMoney } from "@/lib/format";

/**
 * Process a card on the shop's external processor AND log it on the client in
 * one flow: open the processor (run the card), then record the amount so it
 * lands on the customer as a card payment/deposit and updates their balance.
 * (The processor can't report back on its own — this captures it here.)
 */
export function ProcessCardButton({
  url,
  customerId,
  clientName,
  balance = 0,
  isAdmin = false,
}: {
  url: string | null | undefined;
  customerId: string;
  clientName?: string | null;
  balance?: number;
  isAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance > 0 ? String(balance) : "");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  // No processor link configured yet.
  if (!url || !url.trim()) {
    if (!isAdmin) return null;
    return (
      <Link
        href="/settings/branding"
        className={buttonVariants({ variant: "ghost", size: "lg" })}
      >
        <CreditCard className="size-4" /> Set up card processing
      </Link>
    );
  }

  const record = () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) {
      toast.error("Enter the amount you charged.");
      return;
    }
    start(async () => {
      const res = await recordCardPayment(customerId, amt, note || null);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        balance > 0
          ? `Recorded ${formatMoney(amt)} invoice payment.`
          : `Recorded ${formatMoney(amt)} customer deposit.`,
      );
      setOpen(false);
      setNote("");
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => {
          setAmount(balance > 0 ? String(balance) : "");
          setOpen(true);
        }}
      >
        <CreditCard className="size-4" /> Process card
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {balance > 0 ? "Record invoice payment" : "Record customer deposit"}
              {clientName ? ` — ${clientName}` : ""}
            </DialogTitle>
            <DialogDescription>
              Run the card on your processor, then record the amount here.
              {balance > 0
                ? " This applies to the customer's open invoice balance."
                : " This holds money as a customer deposit until an invoice is ready."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ className: "w-full" })}
            >
              <ExternalLink className="size-4" /> Open card processor
            </a>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Amount charged</label>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-11 text-lg font-semibold"
                  autoFocus
                />
              </div>
              {balance > 0 ? (
                <button
                  type="button"
                  onClick={() => setAmount(String(balance))}
                  className="text-xs text-primary hover:underline"
                >
                  Use full balance ({formatMoney(balance)})
                </button>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note (optional)</label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Deposit · auth #1234"
              />
            </div>

            <Button type="button" className="w-full" disabled={pending} onClick={record}>
              {pending
                ? "Recording…"
                : balance > 0
                  ? "Record invoice payment"
                  : "Record customer deposit"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {balance > 0
                ? "Records as payment on the open invoice — no card details stored."
                : "Records as an unapplied customer deposit — not revenue until applied."}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { portalPayInvoice, portalPayQuote } from "./pay-actions";

export function PortalPayBox(props: {
  processorUrl: string | null;
  amountLabel: string;
  amount: number;
  /** Invoice pays the exact balance. Quote lets them pay up to `amount`. */
  mode: "invoice" | "quote";
  invoiceId?: string;
  estimateId?: string;
}) {
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState(props.amount > 0 ? String(props.amount) : "");
  const router = useRouter();
  const reactId = useId();
  const [opKey, setOpKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `pay-${reactId}`,
  );

  if (!(props.amount > 0)) return null;

  if (!props.processorUrl) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        To pay this, call the store. Card payments are not turned on yet.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-3">
      <div className="text-sm font-medium">{props.amountLabel}</div>
      <a
        href={props.processorUrl}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ className: "w-full" })}
      >
        <ExternalLink className="size-4" /> Pay {formatMoney(props.mode === "invoice" ? props.amount : Number(amount) || props.amount)}
      </a>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (props.mode === "invoice" && props.invoiceId) {
            fd.set("invoice_id", props.invoiceId);
          }
          if (props.mode === "quote" && props.estimateId) {
            fd.set("estimate_id", props.estimateId);
            fd.set("amount", amount);
          }
          fd.set("idempotency_key", opKey);
          start(async () => {
            const res =
              props.mode === "invoice" ? await portalPayInvoice(fd) : await portalPayQuote(fd);
            if (res.error) {
              if (res.error.includes("voided")) {
                setOpKey(
                  typeof crypto !== "undefined" && "randomUUID" in crypto
                    ? crypto.randomUUID()
                    : `pay-${reactId}-${Date.now()}`,
                );
              }
              toast.error(res.error);
              return;
            }
            toast.success("Payment recorded.");
            router.refresh();
          });
        }}
      >
        {props.mode === "quote" ? (
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Amount you paid, up to {formatMoney(props.amount)}
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            After the card goes through, record the {formatMoney(props.amount)} payment here.
          </p>
        )}
        <Button type="submit" variant="outline" className="w-full" disabled={pending}>
          {pending ? "Recording…" : "I paid this"}
        </Button>
      </form>
    </div>
  );
}

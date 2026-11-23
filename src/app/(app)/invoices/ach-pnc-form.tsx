"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { prepareAchFile } from "./ach-actions";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AchPncForm({
  invoiceId,
  amount,
  holder,
}: {
  invoiceId: string;
  amount: number;
  holder: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <form
      className="grid gap-2 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const body = new FormData(form);
        body.set("invoice_id", invoiceId);
        start(async () => {
          const res = await prepareAchFile(body);
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          const blob = new Blob([res.file], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = res.filename;
          link.click();
          URL.revokeObjectURL(url);
          form.reset();
          toast.success("PNC file downloaded. The invoice stays unpaid until the deposit shows.");
          router.refresh();
        });
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Amount</span>
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          max={amount.toFixed(2)}
          required
          defaultValue={amount.toFixed(2)}
          className={fieldClass}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Name on the account</span>
        <input name="holder" required defaultValue={holder} className={fieldClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Routing number</span>
        <input name="routing" inputMode="numeric" required autoComplete="off" className={fieldClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Account number</span>
        <input name="account" inputMode="numeric" required autoComplete="off" className={fieldClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Account type</span>
        <select name="account_type" defaultValue="checking" className={fieldClass}>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
        </select>
      </label>
      <label className="flex items-start gap-2 pt-6 text-sm">
        <input type="checkbox" name="authorized" value="yes" required className="mt-1" />
        <span>The customer authorized this debit in writing.</span>
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Preparing…" : "Download the PNC file"}
        </Button>
      </div>
    </form>
  );
}

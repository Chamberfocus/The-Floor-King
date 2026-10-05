"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteCustomerForever } from "@/app/(app)/customer-records/actions";

export function VisibleCustomerDelete({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [state, action, pending] = useActionState(deleteCustomerForever, { ok: false });

  useEffect(() => {
    if (state.ok) router.push("/customer-records");
  }, [state.ok, router]);

  const confirmed = confirmText.trim().toUpperCase() === "DELETE";

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="min-h-11"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" /> Delete
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Delete {customerName}?</DialogTitle>
            <DialogDescription>
              Permanent delete is only allowed when this customer has no linked
              jobs, estimates, invoices, payments, orders, appointments, notes,
              documents, referrals, or other history. If linked records exist,
              deletion is blocked.
            </DialogDescription>
          </DialogHeader>

          <form action={action} className="space-y-3">
            <input type="hidden" name="customer_id" value={customerId} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Type <span className="font-mono text-destructive">DELETE</span> to confirm
              </label>
              <Input
                name="confirmation"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>

            {state.error ? (
              <p className="text-sm text-destructive">{state.error}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Keep customer
              </Button>
              <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
                {pending ? "Deleting…" : "Delete forever"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

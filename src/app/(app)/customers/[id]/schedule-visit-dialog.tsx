"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EstimateScheduler } from "./estimate-scheduler";

/**
 * The job-progress "Schedule it" step lands here with ?schedule=estimate.
 *
 * The scheduler used to live inside a closed "Handle this customer" panel, and
 * the page stripped that query as soon as it opened. The strip reloaded the
 * page and the dialog closed before anyone could use it, so the click looked
 * dead. This dialog sits on the page itself and stays open until it is closed.
 */
export function ScheduleVisitDialog({
  open,
  customerId,
  customerName,
  customerEmail,
  reps,
  defaultRep,
}: {
  open: boolean;
  customerId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  reps: { id: string; name: string }[];
  defaultRep?: string | null;
}) {
  const router = useRouter();
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) setShown(true);
  }, [open]);

  const onOpenChange = (next: boolean) => {
    setShown(next);
    if (next) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("schedule")) return;
    url.searchParams.delete("schedule");
    router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
  };

  return (
    <Dialog open={shown} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Schedule the estimate</DialogTitle>
          <DialogDescription>
            Pick a time for {customerName || "this customer"}. It is saved on their file.
          </DialogDescription>
        </DialogHeader>
        <EstimateScheduler
          customerId={customerId}
          customerName={customerName}
          customerEmail={customerEmail}
          reps={reps}
          defaultRep={defaultRep}
          autoOpen
          redirectTo={`/customers/${customerId}`}
        />
      </DialogContent>
    </Dialog>
  );
}

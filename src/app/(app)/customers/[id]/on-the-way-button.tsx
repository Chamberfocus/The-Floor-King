"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { notifyOnTheWay } from "./onway-actions";

export function OnTheWayButton({ customerId }: { customerId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await notifyOnTheWay(customerId);
          if (r.error) {
            toast.error(r.error);
          } else if (r.eta && r.eta !== "sent") {
            toast.success(`Customer notified — ETA ~${r.eta}`);
          } else {
            toast.success("Customer notified you're on the way");
          }
        })
      }
    >
      <Truck className="size-4" /> {pending ? "Sending…" : "On our way"}
    </Button>
  );
}

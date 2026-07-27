"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { SendToClient } from "@/components/send-to-client";
import { notifyOnTheWay } from "./onway-actions";

export function OnTheWayButton({
  customerId,
  customerName,
  customerEmail,
}: {
  customerId: string;
  customerName?: string | null;
  customerEmail?: string | null;
}) {
  const [pending, start] = useTransition();
  const run = (sendEmail: boolean) =>
    start(async () => {
      const r = await notifyOnTheWay(customerId, sendEmail);
      if (r.error) {
        toast.error(r.error);
      } else if (sendEmail && r.eta && r.eta !== "sent") {
        toast.success(`Customer notified — ETA ~${r.eta}`);
      } else if (sendEmail) {
        toast.success("Customer notified you're on the way");
      } else {
        toast.success("Posted to their portal (no email/text)");
      }
    });
  return (
    <SendToClient
      variant="outline"
      size="lg"
      disabled={pending}
      clientName={customerName}
      email={customerEmail}
      title="Let the customer know you're on the way?"
      description="Sends an ETA by email and text. Either way it's posted in their portal."
      sendLabel="Email & text"
      skipLabel="Portal only"
      onChoose={run}
    >
      <Truck className="size-4" /> {pending ? "Sending…" : "On our way"}
    </SendToClient>
  );
}

"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approveDayOff, denyDayOff } from "./actions";

/** Approve / Deny controls for a pending time-off request (managers). */
export function ApprovalActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await approveDayOff(id);
            toast.success("Approved");
          })
        }
      >
        <Check className="size-4" /> Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await denyDayOff(id);
            toast.success("Denied");
          })
        }
      >
        <X className="size-4" /> Deny
      </Button>
    </div>
  );
}

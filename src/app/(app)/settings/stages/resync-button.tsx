"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resyncAllStages } from "./actions";

/** Re-align every existing customer to the current stage builder — placing any
 *  without a stage and refreshing the dashboard mirror. Safe to re-run. */
export function ResyncStagesButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await resyncAllStages();
          if (res.ok)
            toast.success(
              `Synced ${res.synced} customer${res.synced === 1 ? "" : "s"} to your current stages${
                res.assigned ? ` — ${res.assigned} placed for the first time` : ""
              }.`,
            );
          else toast.error(res.error || "Couldn't sync customers.");
        })
      }
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
      {pending ? "Syncing…" : "Sync all customers to these stages"}
    </Button>
  );
}

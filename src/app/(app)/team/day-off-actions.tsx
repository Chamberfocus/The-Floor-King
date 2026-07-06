"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { removeDayOff } from "./actions";

/** Small ✕ to remove a posted day off (own, or office/admin). */
export function DeleteDayOff({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Remove day off"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeDayOff(id);
          toast.success("Removed");
        })
      }
      className="inline-flex items-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      <X className="size-4" />
    </button>
  );
}

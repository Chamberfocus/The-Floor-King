"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteEstimate, deleteAllDraftEstimates } from "./actions";

/** Trash button on an estimate row — confirms, then deletes (back to the list). */
export function DeleteEstimateButton({ id }: { id: string }) {
  return (
    <form
      action={deleteEstimate}
      onSubmit={(e) => {
        if (!window.confirm("Delete this estimate? This can't be undone.")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="icon-sm" aria-label="Delete estimate">
        <Trash2 className="size-4 text-destructive" />
      </Button>
    </form>
  );
}

/** Wipe all draft estimates at once — for clearing out test quotes. */
export function ClearDraftsButton() {
  return (
    <form
      action={deleteAllDraftEstimates}
      onSubmit={(e) => {
        if (
          !window.confirm(
            "Delete ALL draft estimates? This removes every unsent quote and can't be undone.",
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="outline" size="lg" className="text-destructive">
        <Trash2 className="size-4" /> Delete all drafts
      </Button>
    </form>
  );
}

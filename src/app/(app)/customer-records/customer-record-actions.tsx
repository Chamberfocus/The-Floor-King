"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  archiveCustomerRecord,
  deleteCustomerForever,
  restoreCustomerRecord,
  type CustomerRecordActionState,
} from "./actions";

const initialState: CustomerRecordActionState = { ok: false };

export function CustomerRecordActions({
  customerId,
  archived,
  canDelete,
}: {
  customerId: string;
  archived: boolean;
  canDelete: boolean;
}) {
  const [archiveState, archiveAction, archivePending] = useActionState(
    archived ? restoreCustomerRecord : archiveCustomerRecord,
    initialState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteCustomerForever,
    initialState,
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={archiveAction}>
        <input type="hidden" name="customer_id" value={customerId} />
        <Button type="submit" variant="outline" size="sm" disabled={archivePending}>
          {archivePending ? "Working…" : archived ? "Restore" : "Archive"}
        </Button>
      </form>

      {canDelete ? (
        <form
          action={deleteAction}
          onSubmit={(e) => {
            const typed = window.prompt(
              "Permanent delete is only for unused records. Type DELETE to continue.",
            );
            if (typed !== "DELETE") {
              e.preventDefault();
              return;
            }
            const input = e.currentTarget.elements.namedItem(
              "confirmation",
            ) as HTMLInputElement | null;
            if (input) input.value = typed;
          }}
        >
          <input type="hidden" name="customer_id" value={customerId} />
          <input type="hidden" name="confirmation" defaultValue="" />
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={deletePending}
          >
            {deletePending ? "Deleting…" : "Delete forever"}
          </Button>
        </form>
      ) : null}

      {archiveState.error ? (
        <p className="max-w-80 text-right text-xs text-destructive">{archiveState.error}</p>
      ) : null}
      {deleteState.error ? (
        <p className="max-w-80 text-right text-xs text-destructive">{deleteState.error}</p>
      ) : null}
    </div>
  );
}

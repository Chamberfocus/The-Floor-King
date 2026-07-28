"use client";

import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { deleteInvoice } from "./actions";

/** Delete an invoice (and its payments) with a confirm step. Staff only. */
export function DeleteInvoiceButton({
  id,
  customerId,
  label,
  redirectTo,
  size = "icon-sm",
}: {
  id: string;
  customerId?: string | null;
  /** Invoice number / name, for the confirm dialog. */
  label?: string | null;
  /** Where to land after deleting (e.g. "/invoices" to stay on the list). */
  redirectTo?: string;
  size?: "icon-sm" | "sm";
}) {
  return (
    <form action={deleteInvoice}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="customer_id" value={customerId ?? ""} />
      {redirectTo ? (
        <input type="hidden" name="redirect_to" value={redirectTo} />
      ) : null}
      <ConfirmButton
        variant="ghost"
        size={size}
        title={`Delete ${label || "this invoice"}?`}
        description="Permanently deletes the invoice, its line items, and every recorded payment. Any linked order is unlinked. This can't be undone."
        confirmLabel="Delete invoice"
        destructive
        aria-label="Delete invoice"
      >
        <Trash2 className="size-4 text-muted-foreground" />
        {size === "sm" ? <span className="ml-1">Delete</span> : null}
      </ConfirmButton>
    </form>
  );
}

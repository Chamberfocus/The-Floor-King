"use client";

import { RecordLifecycleMenu } from "@/components/record-lifecycle-menu";

/** Archive, restore, or permanently delete one invoice after an impact preview. */
export function DeleteInvoiceButton({
  id,
  archivedAt,
  isAdmin = false,
}: {
  id: string;
  customerId?: string | null;
  label?: string | null;
  redirectTo?: string;
  size?: "icon-sm" | "sm";
  archivedAt?: string | null;
  isAdmin?: boolean;
}) {
  return (
    <RecordLifecycleMenu
      recordType="invoice"
      recordId={id}
      archivedAt={archivedAt}
      allowArchive
      allowDelete={isAdmin}
    />
  );
}

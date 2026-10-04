"use client";

import { RecordLifecycleMenu } from "@/components/record-lifecycle-menu";

/** Archive, restore, or permanently delete one invoice after an impact preview. */
export function DeleteInvoiceButton({
  id,
  archivedAt,
  canArchive = false,
  isAdmin = false,
}: {
  id: string;
  customerId?: string | null;
  label?: string | null;
  redirectTo?: string;
  size?: "icon-sm" | "sm";
  archivedAt?: string | null;
  /** Administrator or office. Server actions enforce the same rule. */
  canArchive?: boolean;
  isAdmin?: boolean;
}) {
  return (
    <RecordLifecycleMenu
      recordType="invoice"
      recordId={id}
      archivedAt={archivedAt}
      allowArchive={canArchive}
      allowDelete={isAdmin}
    />
  );
}

"use client";

import { RecordLifecycleMenu } from "@/components/record-lifecycle-menu";

/** Archive, restore, or permanently delete one estimate after an impact preview. */
export function DeleteEstimateButton({
  id,
  archivedAt,
  canArchive = false,
  isAdmin = false,
}: {
  id: string;
  customerId?: string;
  customerName?: string;
  variant?: "icon" | "full";
  archivedAt?: string | null;
  /** Administrator or office. Server actions enforce the same rule. */
  canArchive?: boolean;
  isAdmin?: boolean;
}) {
  return (
    <RecordLifecycleMenu
      recordType="estimate"
      recordId={id}
      archivedAt={archivedAt}
      allowArchive={canArchive}
      allowDelete={isAdmin}
    />
  );
}

/** Bulk permanent deletion is not available. */
export function ClearDraftsButton() {
  return null;
}

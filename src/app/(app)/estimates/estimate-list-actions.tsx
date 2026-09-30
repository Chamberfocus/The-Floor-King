"use client";

import { RecordLifecycleMenu } from "@/components/record-lifecycle-menu";

/** Archive, restore, or permanently delete one estimate after an impact preview. */
export function DeleteEstimateButton({
  id,
  archivedAt,
  isAdmin = false,
}: {
  id: string;
  customerId?: string;
  customerName?: string;
  variant?: "icon" | "full";
  archivedAt?: string | null;
  isAdmin?: boolean;
}) {
  return (
    <RecordLifecycleMenu
      recordType="estimate"
      recordId={id}
      archivedAt={archivedAt}
      allowArchive
      allowDelete={isAdmin}
    />
  );
}

/** Bulk permanent deletion is not available. */
export function ClearDraftsButton() {
  return null;
}

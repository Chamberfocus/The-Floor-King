"use client";

import type { ClassifiedImportRow } from "@/lib/customer-resolve";

export const IMPORT_CLASS_LABEL: Record<ClassifiedImportRow["class"], string> = {
  NEW: "New",
  MATCHED_EXISTING: "Already on file",
  POSSIBLE_DUPLICATE: "Possible duplicate",
  INVALID: "Invalid",
};

export function classForIndex(
  classified: ClassifiedImportRow[] | undefined,
  index: number,
): ClassifiedImportRow["class"] | null {
  return classified?.find((r) => r.index === index)?.class ?? null;
}

export function ImportClassSummary({
  summary,
}: {
  summary: {
    new: number;
    matchedExisting: number;
    possibleDuplicates: number;
    invalid: number;
  };
}) {
  return (
    <p className="text-sm">
      <span className="font-medium">{summary.new} new</span>
      {" · "}
      {summary.matchedExisting} already on file
      {" · "}
      {summary.possibleDuplicates} possible duplicates (need review, not imported)
      {" · "}
      {summary.invalid} invalid
    </p>
  );
}

export function ImportClassBadge({
  cls,
}: {
  cls: ClassifiedImportRow["class"] | null;
}) {
  if (!cls) return null;
  const tone =
    cls === "NEW"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
      : cls === "MATCHED_EXISTING"
        ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
        : cls === "POSSIBLE_DUPLICATE"
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {IMPORT_CLASS_LABEL[cls]}
    </span>
  );
}

import type { UserRole } from "@/lib/types";

/** A date on the board that the customer has not been told is locked. */
export type InstallHold = "requested" | "confirmed";

export const INSTALL_BOOK_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
];

export const REQUESTED_INSTALL_MESSAGE =
  "Date requested. The crew is held. The customer is not told this date is locked until the material is in the building and you confirm it.";

export function canBookInstall(role: string | null | undefined): boolean {
  return !!role && (INSTALL_BOOK_ROLES as string[]).includes(role);
}

/**
 * Goods in the building, or an explicit override, confirms the date.
 * Otherwise the date is only requested.
 */
export function planInstallHold(input: {
  materialsReady: boolean;
  overrideReason?: string | null;
}): InstallHold {
  if (input.materialsReady) return "confirmed";
  if ((input.overrideReason ?? "").trim()) return "confirmed";
  return "requested";
}

/**
 * Legacy rows booked before install_hold existed count as confirmed once
 * they have a date. A requested hold is never told to the customer as locked.
 */
export function customerToldInstallIsLocked(
  hold: string | null | undefined,
  hasDate: boolean,
): boolean {
  if (hold === "requested") return false;
  if (hold === "confirmed") return true;
  return hasDate;
}

export function portalInstallHoldCopy(dateLabel: string): {
  title: string;
  detail: string;
} {
  return {
    title: "Install requested",
    detail: `We're holding ${dateLabel}. We'll confirm it when your flooring is in the building.`,
  };
}

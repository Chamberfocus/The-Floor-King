import type { JobStatus } from "@/lib/types";
import { isAllowedJobStatusTransition, JOB_CHANGED_MESSAGE } from "@/lib/job-status";

/**
 * Factual installation closeout. These lines describe what is already stored.
 * They do not tell anyone what to do next — the customer Record Action Center
 * is the only instruction engine.
 */
export type InstallCloseoutFacts = {
  installation: string;
  completion: string;
  signOff: "Recorded" | "Not recorded";
  photoCount: number;
  openCallbacks: number;
  /** Null when this viewer is not authorized to see a collectible balance. */
  balanceLabel: string | null;
};

export function installationStatusFact(
  status: JobStatus | null | undefined,
): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In progress";
    case "scheduled":
      return "Scheduled";
    case "cancelled":
      return "Cancelled";
    default:
      return "Not started";
  }
}

export function installCloseoutFacts(input: {
  status: JobStatus | null | undefined;
  completedAt: string | null | undefined;
  signOffRecorded: boolean;
  photoCount: number;
  openCallbacks: number;
  /** Pass null when the viewer must not see money. */
  openBalance: number | null;
  formatMoney: (n: number) => string;
}): InstallCloseoutFacts {
  const completed = input.status === "completed";
  return {
    installation: installationStatusFact(input.status),
    completion: completed
      ? input.completedAt
        ? "Recorded"
        : "Completed"
      : "Not recorded",
    signOff: input.signOffRecorded ? "Recorded" : "Not recorded",
    photoCount: Math.max(0, input.photoCount),
    openCallbacks: Math.max(0, input.openCallbacks),
    balanceLabel:
      input.openBalance == null
        ? null
        : input.openBalance > 0
          ? `${input.formatMoney(input.openBalance)} remaining`
          : "Paid",
  };
}

/** Customer sign-off is a stored signature, not payment or a closed callback. */
export function customerSignOffRecorded(input: {
  signature?: string | null;
  signedName?: string | null;
  fileSignatureCount?: number;
}): boolean {
  if ((input.signature ?? "").trim()) return true;
  if ((input.signedName ?? "").trim()) return true;
  return (input.fileSignatureCount ?? 0) > 0;
}

export function canStartInstallation(
  status: JobStatus | null | undefined,
): boolean {
  if (!status || status === "in_progress") return false;
  return isAllowedJobStatusTransition(status, "in_progress");
}

export function canCompleteInstallation(
  status: JobStatus | null | undefined,
): boolean {
  if (!status || status === "completed" || status === "cancelled") return false;
  return isAllowedJobStatusTransition(status, "completed");
}

type StatusIntent = "start" | "complete" | "other";

export function jobStatusEmployeeMessage(
  intent: StatusIntent,
  reason: "missing" | "blocked" | "save" | "stale" | "forbidden",
  from?: JobStatus | null,
): string {
  if (reason === "stale") return JOB_CHANGED_MESSAGE;
  if (reason === "forbidden") return "Not authorized.";
  if (reason === "blocked" && from === "cancelled" && intent === "complete") {
    return "A cancelled installation cannot be marked complete.";
  }
  if (intent === "complete") {
    return "This installation could not be marked complete. Refresh and try again.";
  }
  if (intent === "start") {
    return "This installation could not be started. Refresh and try again.";
  }
  return "This installation could not be updated. Refresh and try again.";
}

/** Customer-portal schedule card. Uses only fields already on jobs_customer. */
export function portalInstallScheduleCopy(input: {
  status: JobStatus | null | undefined;
  scheduledDateLabel: string | null;
  windowLabel: string | null;
  installerName: string | null;
}): { title: string; detail: string } {
  const bits = [
    input.scheduledDateLabel,
    input.windowLabel ? `arriving ${input.windowLabel}` : null,
    input.installerName ? `with ${input.installerName}` : null,
  ].filter(Boolean);
  const detail = bits.join(" · ");
  if (input.status === "completed") {
    return {
      title: "Installation completed",
      detail: detail || "Your installation is complete.",
    };
  }
  if (input.status === "in_progress") {
    return {
      title: "Installation in progress",
      detail: detail || "Your installation is underway.",
    };
  }
  if (input.status === "cancelled") {
    return {
      title: "Installation cancelled",
      detail: detail || "This installation was cancelled.",
    };
  }
  return {
    title: "Confirmed installation",
    detail,
  };
}

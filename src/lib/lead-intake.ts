/**
 * What the add-customer form is allowed to decide in one submit:
 * who owns the lead, and whether an estimate visit is booked with it.
 * Both add-customer screens use these rules so they cannot drift.
 */

import { isSalesBookRole, leadAcceptanceForAssignment, seesEveryLead } from "@/lib/lead-acceptance";

export function canAssignLead(role: string | null | undefined): boolean {
  return seesEveryLead(role) || role === "scheduler";
}

/** People who can be the salesperson on a new lead. The owner sells, so admin counts. */
export function canOwnSalesLead(role: string | null | undefined): boolean {
  return role === "admin" || isSalesBookRole(role);
}

export function assignedLeadOwner(input: {
  actorId: string;
  actorRole: string;
  requestedId: string | null;
  requestedRole: string | null;
}): {
  assignedTo: string;
  acceptance: ReturnType<typeof leadAcceptanceForAssignment>;
} {
  if (
    input.requestedId &&
    input.requestedId !== input.actorId &&
    canAssignLead(input.actorRole) &&
    input.requestedRole &&
    canOwnSalesLead(input.requestedRole)
  ) {
    return {
      assignedTo: input.requestedId,
      acceptance: leadAcceptanceForAssignment({
        actorId: input.actorId,
        assigneeId: input.requestedId,
        assigneeIsSales: isSalesBookRole(input.requestedRole),
      }),
    };
  }
  return { assignedTo: input.actorId, acceptance: null };
}

export type LeadEstimateVisit = {
  date: string;
  time: string;
  end: string;
};

function realDay(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function clock(value: string): string | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

/**
 * No date means "save the lead only". A date with a backwards window is an
 * error so we never write a customer and then fail the visit.
 */
export function parseLeadEstimateVisit(input: {
  date: string;
  time: string;
  end: string;
}): LeadEstimateVisit | { error: string } | null {
  const date = input.date.trim();
  if (!date) return null;
  if (!realDay(date)) return { error: "Enter a real day for the estimate visit." };
  const time = clock(input.time.trim() || "09:00");
  const end = clock(input.end.trim() || "11:00");
  if (!time || !end) return { error: "Enter an arrival time for the estimate visit." };
  if (end <= time) return { error: "The estimate window has to end after it starts." };
  return { date, time, end };
}

/** A booked visit moves a brand-new lead to Estimate Scheduled. A later stage stays. */
export function leadStageForVisit(stage: string, booked: boolean): string {
  if (booked && (stage === "new" || stage === "contacted" || stage === "")) {
    return "estimate_scheduled";
  }
  return stage || "new";
}

export function leadVisitAddress(parts: Array<string | null | undefined>): string | null {
  const text = parts.map((part) => (part ?? "").trim()).filter(Boolean).join(", ");
  return text || null;
}

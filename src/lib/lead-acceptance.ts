/**
 * A lead stays on the customer. Acceptance is a status on that customer.
 * The owner, office, and sales managers already see every customer.
 * A salesperson sees the customers assigned to them.
 */

export const SALES_BOOK_ROLES = ["salesman", "sales_manager"] as const;

export type LeadAcceptance = "pending" | "accepted" | "declined";

export function isSalesBookRole(role: string | null | undefined): boolean {
  return role === "salesman" || role === "sales_manager";
}

/** Who can see every lead, not only their own book. */
export function seesEveryLead(role: string | null | undefined): boolean {
  return role === "admin" || role === "office" || role === "sales_manager";
}

export function leadAcceptanceForAssignment(input: {
  actorId: string;
  assigneeId: string | null;
  assigneeIsSales: boolean;
}): {
  lead_acceptance: LeadAcceptance | null;
  lead_acceptance_note: null;
  lead_acceptance_at: string | null;
  lead_assigned_by: string | null;
} | null {
  if (!input.assigneeId) {
    return {
      lead_acceptance: null,
      lead_acceptance_note: null,
      lead_acceptance_at: null,
      lead_assigned_by: null,
    };
  }
  if (!input.assigneeIsSales) return null;
  const self = input.assigneeId === input.actorId;
  return {
    lead_acceptance: self ? "accepted" : "pending",
    lead_acceptance_note: null,
    lead_acceptance_at: self ? new Date().toISOString() : null,
    lead_assigned_by: input.actorId,
  };
}

/** The assigned salesperson must accept before they write or schedule the estimate. */
export function estimateBlockedUntilLeadAccepted(input: {
  role: string;
  userId: string;
  assignedTo: string | null;
  acceptance: string | null;
}): boolean {
  return (
    isSalesBookRole(input.role) &&
    !!input.userId &&
    input.assignedTo === input.userId &&
    input.acceptance === "pending"
  );
}

export const LEAD_ACCEPT_REQUIRED =
  "Accept this lead before you start the estimate. Open the customer and accept it.";

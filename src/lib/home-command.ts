/**
 * Home is a list of work queues, not a second "what to do next" engine.
 * The Record Action Center on the customer stays the only instruction.
 * These links open the same filtered lists the rest of the app already uses.
 */
import type { UserRole } from "@/lib/types";
import {
  MONEY_LIST_ROLES,
  ORDER_LIST_ROLES,
  SERVICE_LIST_ROLES,
  TASK_LIST_ROLES,
} from "@/lib/work-queues";

export type HomeCommandId =
  | "followups"
  | "estimates"
  | "material"
  | "ready"
  | "today"
  | "service"
  | "tasks"
  | "orders"
  | "warehouse";

export type HomeCommandSpec = {
  id: HomeCommandId;
  href: string;
  singular: string;
  plural: string;
};

const JOB_ROLES = new Set<UserRole>([
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
]);
const SCHEDULERS = new Set<UserRole>(["admin", "office", "scheduler"]);
const WAREHOUSE = new Set<UserRole>(["admin", "office", "warehouse"]);
const FOLLOWUPS = new Set<UserRole>([
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
]);

export function homeCommandsForRole(role: UserRole): HomeCommandSpec[] {
  const specs: HomeCommandSpec[] = [];
  if (FOLLOWUPS.has(role)) {
    specs.push({
      id: "followups",
      href: "/customers?stuck=1",
      singular: "follow-up due",
      plural: "follow-ups due",
    });
  }
  if (MONEY_LIST_ROLES.includes(role)) {
    specs.push({
      id: "estimates",
      href: "/estimates?view=followup",
      singular: "estimate needs follow-up",
      plural: "estimates need follow-up",
    });
  }
  if (JOB_ROLES.has(role)) {
    specs.push({
      id: "material",
      href: "/jobs?view=material",
      singular: "job needs material",
      plural: "jobs need material",
    });
  }
  if (JOB_ROLES.has(role) && role !== "crew") {
    specs.push({
      id: "ready",
      href: SCHEDULERS.has(role) ? "/install-scheduler" : "/jobs?view=ready",
      singular: "job ready to schedule",
      plural: "jobs ready to schedule",
    });
  }
  if (JOB_ROLES.has(role)) {
    specs.push({
      id: "today",
      href: "/jobs?view=scheduled&day=today",
      singular: "install today",
      plural: "installs today",
    });
  }
  if (SERVICE_LIST_ROLES.includes(role)) {
    specs.push({
      id: "service",
      href: "/service",
      singular: "service call needs attention",
      plural: "service calls need attention",
    });
  }
  if (TASK_LIST_ROLES.includes(role)) {
    specs.push({
      id: "tasks",
      href: role === "salesman" ? "/tasks?view=mine" : "/tasks?view=open",
      singular: "open task",
      plural: "open tasks",
    });
  }
  if (ORDER_LIST_ROLES.includes(role)) {
    specs.push({
      id: "orders",
      href: "/orders",
      singular: "order needs review",
      plural: "orders need review",
    });
  }
  if (WAREHOUSE.has(role)) {
    specs.push({
      id: "warehouse",
      href: "/warehouse",
      singular: "job needs warehouse prep",
      plural: "jobs need warehouse prep",
    });
  }
  return specs;
}

export function homeCommandText(count: number, spec: HomeCommandSpec): string {
  const noun = count === 1 ? spec.singular : spec.plural;
  return `${count} ${noun}`;
}

const WAREHOUSE_COUNT_ROLES = new Set<UserRole>(["admin", "office", "warehouse"]);

/**
 * Arguments for job_queue_page. The signed-in client runs this (RLS applies).
 * Crew is limited to direct assignment plus the active crews linked to that user.
 * A claim-board job is not included. Warehouse asks only for the prep queue.
 */
export function homeJobQueueArgs(input: {
  role: UserRole;
  userId: string;
  queue: "material" | "ready" | "warehouse_active";
  crewIds?: readonly string[];
}): Record<string, unknown> {
  if (input.queue === "warehouse_active") {
    if (!WAREHOUSE_COUNT_ROLES.has(input.role)) {
      throw new Error("Warehouse prep is not on this home.");
    }
    return {
      p_queue: "warehouse_active",
      p_search: null,
      p_phone_like: null,
      p_digits: null,
      p_mine: null,
      p_assigned: null,
      p_crew_ids: null,
      p_keep_pickup: true,
    };
  }
  if (input.role === "crew") {
    if (!input.userId) throw new Error("Crew home requires the signed-in user.");
    const crewIds = (input.crewIds ?? []).filter((id) => !!id);
    return {
      p_queue: input.queue,
      p_search: null,
      p_phone_like: null,
      p_digits: null,
      p_mine: null,
      p_assigned: input.userId,
      p_crew_ids: crewIds.length ? crewIds : null,
      p_keep_pickup: false,
    };
  }
  return {
    p_queue: input.queue,
    p_search: null,
    p_phone_like: null,
    p_digits: null,
    p_mine: input.role === "salesman" ? input.userId : null,
    p_assigned: null,
    p_crew_ids: null,
    p_keep_pickup: false,
  };
}

/** Today's installs. Crew stays on their assignments. A salesman stays on their book. */
export function homeTodayScope(
  role: UserRole,
  userId: string,
): { assignedTo?: string; mineFor?: string } {
  if (role === "crew") {
    if (!userId) throw new Error("Crew home requires the signed-in user.");
    return { assignedTo: userId };
  }
  if (role === "salesman") {
    if (!userId) throw new Error("Salesman home requires the signed-in user.");
    return { mineFor: userId };
  }
  return {};
}

export function homeEstimateCountArgs(role: UserRole, userId: string, sentBefore: string) {
  if (!MONEY_LIST_ROLES.includes(role)) throw new Error("Estimate follow-up is not on this home.");
  return {
    p_status: "sent",
    p_sent_before: sentBefore,
    p_mine: role === "salesman" ? userId : null,
    p_search: null,
  };
}

export function homeTaskCountArgs(role: UserRole, userId: string, nowIso: string) {
  if (!TASK_LIST_ROLES.includes(role)) throw new Error("Tasks are not on this home.");
  return {
    p_view: "open",
    p_user: userId,
    p_see_all: role !== "salesman",
    p_now: nowIso,
    p_search: null,
  };
}

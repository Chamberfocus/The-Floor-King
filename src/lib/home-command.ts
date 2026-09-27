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

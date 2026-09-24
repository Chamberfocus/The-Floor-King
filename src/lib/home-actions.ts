/**
 * Home action center — presentation only.
 *
 * Priority and section placement are derived from facts the rest of the CRM
 * already stores. This module does not create statuses, balances, or schedule
 * decisions. Callers must pass only records the signed-in role can already open.
 */
import type { UserRole } from "@/lib/types";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { isTaskOverdue } from "@/lib/office-task";
import {
  DEFAULT_DEPOSIT_FOLLOWUP_DAYS,
  DEFAULT_ESTIMATE_FOLLOWUP_DAYS,
} from "@/lib/ops-followup";

export type HomePriority = "urgent" | "today" | "upcoming";
export type HomeSectionId = "today" | "attention" | "upcoming" | "mine";

export interface HomeItem {
  id: string;
  priority: HomePriority;
  title: string;
  why: string;
  subject: string | null;
  meta: string | null;
  owner: string | null;
  action: string;
  href: string;
}

export interface HomeSection {
  id: HomeSectionId;
  label: string;
  items: HomeItem[];
}

export interface HomeCenter {
  greeting: string;
  sections: HomeSection[];
  caughtUp: boolean;
}

export interface HomeFollowUp {
  id: string;
  name: string;
  dueAt: string;
  /** Stage next-action copy. This is the customer "Stuck" reason when overdue. */
  nextAction: string | null;
  ownerId: string | null;
}

export interface HomeEstimate {
  id: string;
  name: string;
  sentAt: string | null;
  totalLabel: string | null;
  ownerId: string | null;
}

export interface HomeDeposit {
  id: string;
  name: string;
  approvedAt: string | null;
  amountLabel: string | null;
  ownerId: string | null;
}

export interface HomeInvoice {
  id: string;
  name: string;
  number: string | null;
  dueAt: string | null;
  balanceLabel: string;
  ownerId: string | null;
}

export interface HomeMeasure {
  id: string;
  name: string;
  startsAt: string;
  ownerName: string | null;
  href: string;
}

export interface HomeInstall {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  scheduledDate: string;
  assigneeId: string | null;
  customerOwnerId: string | null;
  warehouseReadyAt: string | null;
  hasMaterialNeed: boolean;
  href: string;
}

export interface HomeUnscheduled {
  id: string;
  name: string;
  assigneeId: string | null;
  customerOwnerId: string | null;
  hasMaterialNeed: boolean;
  warehouseReadyAt: string | null;
  href: string;
}

export interface HomeCallback {
  id: string;
  name: string;
  followUpAt: string | null;
  href: string;
}

export interface HomeTask {
  id: string;
  title: string;
  dueAt: string | null;
  status: string;
  href: string;
}

export interface HomeSignals {
  now: Date;
  role: UserRole;
  userId: string;
  firstName: string;
  followUps?: HomeFollowUp[];
  sentEstimates?: HomeEstimate[];
  deposits?: HomeDeposit[];
  invoices?: HomeInvoice[];
  measures?: HomeMeasure[];
  installs?: HomeInstall[];
  unscheduled?: HomeUnscheduled[];
  callbacks?: HomeCallback[];
  tasks?: HomeTask[];
}

const SECTION_LABEL: Record<HomeSectionId, string> = {
  today: "Today",
  attention: "Needs attention",
  upcoming: "Coming up",
  mine: "My work",
};

const SECTION_ORDER: HomeSectionId[] = ["today", "attention", "upcoming", "mine"];
const SECTION_LIMIT = 8;

const SALES_VIEW: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];
const ESTIMATE_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const MONEY_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const JOB_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler", "crew"];
const SCHEDULE_ROLES: UserRole[] = ["admin", "office", "scheduler"];
const SERVICE_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];

function ymd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function dayStamp(value: string): string {
  return value.slice(0, 10);
}

function daysFromToday(dateYmd: string, todayYmd: string): number {
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${dateYmd}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function ageLabel(from: string | null, now: Date): string | null {
  const t = parseTime(from);
  if (t == null) return null;
  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function greeting(now: Date, firstName: string): string {
  const hour = now.getUTCHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${hello}, ${firstName || "there"}`;
}

function owns(role: UserRole, userId: string, ownerId: string | null): boolean {
  if (role !== "salesman") return true;
  return ownerId === userId;
}

function crewOwns(role: UserRole, userId: string, assigneeId: string | null): boolean {
  if (role !== "crew") return true;
  return assigneeId === userId;
}

function push(bucket: Map<HomeSectionId, HomeItem[]>, section: HomeSectionId, item: HomeItem) {
  const list = bucket.get(section) ?? [];
  if (list.some((row) => row.id === item.id)) return;
  list.push(item);
  bucket.set(section, list);
}

/**
 * Rules, in order:
 * - Overdue customer follow-up (next_action_due before now) is Urgent.
 *   The stage next-action is the reason. That is the same Stuck check as the
 *   customer page. If there is no next-action text, the item says the date passed.
 * - A follow-up due later today is Today. Within 7 days is Upcoming.
 * - A sent estimate at least 2 days old (the existing follow-up delay) is
 *   Needs attention. Five days or more is Urgent.
 * - An approved estimate with no deposit on file is Needs attention.
 *   Older than 1 day (the existing deposit follow-up delay) is Urgent.
 * - An open invoice due before today is Urgent. Due today is Today.
 *   Due within 7 days is Upcoming. Other open invoices are not listed.
 * - A measure or install today is Today, unless the install still needs
 *   warehouse-ready material. That uses assessMaterialsReadyForSchedule and
 *   is Urgent when the install is today or within 2 days.
 * - An unscheduled job whose materials are ready (or it has no material need)
 *   is Needs attention for people who can schedule.
 * - An open service callback with a past follow-up, or none, is Urgent.
 *   A future callback within 7 days is Upcoming.
 * - Office tasks use isTaskOverdue. Overdue is Urgent, due today is Today,
 *   and the rest of the week is My work.
 * Each fact is placed in one section. Urgent facts go to Needs attention.
 */
export function buildHomeCenter(signals: HomeSignals): HomeCenter {
  const now = signals.now;
  const today = ymd(now);
  const role = signals.role;
  const userId = signals.userId;
  const bucket = new Map<HomeSectionId, HomeItem[]>();

  if (SALES_VIEW.includes(role)) {
    for (const row of signals.followUps ?? []) {
      if (!owns(role, userId, row.ownerId)) continue;
      const due = parseTime(row.dueAt);
      if (due == null) continue;
      const dueDay = dayStamp(row.dueAt);
      const overdue = due < now.getTime();
      const ahead = daysFromToday(dueDay, today);
      if (!overdue && ahead > 7) continue;
      const reason = row.nextAction?.trim() || null;
      const priority: HomePriority = overdue ? "urgent" : ahead <= 0 ? "today" : "upcoming";
      push(bucket, priority === "urgent" ? "attention" : priority === "today" ? "today" : "upcoming", {
        id: `follow-${row.id}`,
        priority,
        title: overdue ? (reason ? "Stuck" : "Follow-up overdue") : "Customer follow-up",
        why: overdue
          ? reason ?? "The follow-up date has passed."
          : reason ?? "A follow-up is due.",
        subject: row.name,
        meta: overdue ? ageLabel(row.dueAt, now) : ahead <= 0 ? "Due today" : `Due in ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open customer",
        href: `/customers/${row.id}`,
      });
    }
  }

  if (ESTIMATE_ROLES.includes(role)) {
    for (const row of signals.sentEstimates ?? []) {
      if (!owns(role, userId, row.ownerId)) continue;
      const sent = parseTime(row.sentAt);
      if (sent == null) continue;
      const age = Math.floor((now.getTime() - sent) / 86_400_000);
      if (age < DEFAULT_ESTIMATE_FOLLOWUP_DAYS) continue;
      const priority: HomePriority = age >= 5 ? "urgent" : "today";
      push(bucket, "attention", {
        id: `est-${row.id}`,
        priority,
        title: "Estimate follow-up",
        why: "This estimate was sent and has not been updated.",
        subject: row.name,
        meta: [ageLabel(row.sentAt, now), row.totalLabel].filter(Boolean).join(" · ") || null,
        owner: null,
        action: "Open estimate",
        href: `/estimates/${row.id}`,
      });
    }
    for (const row of signals.deposits ?? []) {
      if (!owns(role, userId, row.ownerId)) continue;
      const approved = parseTime(row.approvedAt);
      const age = approved == null ? DEFAULT_DEPOSIT_FOLLOWUP_DAYS : Math.floor((now.getTime() - approved) / 86_400_000);
      const priority: HomePriority = age >= DEFAULT_DEPOSIT_FOLLOWUP_DAYS ? "urgent" : "today";
      push(bucket, "attention", {
        id: `dep-${row.id}`,
        priority,
        title: "Deposit needed",
        why: "The estimate is approved and no deposit is on file.",
        subject: row.name,
        meta: [row.amountLabel, ageLabel(row.approvedAt, now)].filter(Boolean).join(" · ") || null,
        owner: null,
        action: "Collect deposit",
        href: `/estimates/${row.id}`,
      });
    }
  }

  if (MONEY_ROLES.includes(role)) {
    for (const row of signals.invoices ?? []) {
      if (!owns(role, userId, row.ownerId)) continue;
      if (!row.dueAt) continue;
      const ahead = daysFromToday(dayStamp(row.dueAt), today);
      if (ahead > 7) continue;
      const priority: HomePriority = ahead < 0 ? "urgent" : ahead === 0 ? "today" : "upcoming";
      const section: HomeSectionId = priority === "urgent" ? "attention" : priority === "today" ? "today" : "upcoming";
      push(bucket, section, {
        id: `inv-${row.id}`,
        priority,
        title: ahead < 0 ? "Overdue invoice" : "Invoice due",
        why: ahead < 0 ? "This invoice still has a balance past its due date." : "A balance is due.",
        subject: row.name,
        meta: [row.balanceLabel, row.number ? `#${row.number}` : null].filter(Boolean).join(" · ") || null,
        owner: null,
        action: "Open invoice",
        href: `/invoices/${row.id}`,
      });
    }
  }

  if (SALES_VIEW.includes(role)) {
    for (const row of signals.measures ?? []) {
      const ahead = daysFromToday(dayStamp(row.startsAt), today);
      if (ahead < 0 || ahead > 7) continue;
      const when = new Date(row.startsAt);
      const time = Number.isFinite(when.getTime())
        ? when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
        : null;
      push(bucket, ahead === 0 ? "today" : "upcoming", {
        id: `meas-${row.id}`,
        priority: ahead === 0 ? "today" : "upcoming",
        title: ahead === 0 ? "Measure today" : "Measure coming up",
        why: ahead === 0 ? "This measure is on today's calendar." : "A measure is on the calendar this week.",
        subject: row.name,
        meta: time,
        owner: row.ownerName,
        action: "Open measure",
        href: row.href,
      });
    }
  }

  if (JOB_ROLES.includes(role)) {
    for (const row of signals.installs ?? []) {
      if (!crewOwns(role, userId, row.assigneeId)) continue;
      if (!owns(role, userId, row.customerOwnerId)) continue;
      const ahead = daysFromToday(row.scheduledDate, today);
      if (ahead < 0 || ahead > 7) continue;
      const materials = assessMaterialsReadyForSchedule({
        warehouseReadyAt: row.warehouseReadyAt,
        hasMaterialNeed: row.hasMaterialNeed,
      });
      const soon = ahead <= 2;
      if (!materials.ready && soon) {
        push(bucket, "attention", {
          id: `mat-${row.id}`,
          priority: "urgent",
          title: "Material not ready",
          why: ahead === 0
            ? "The install is today and materials are not warehouse-ready."
            : "The install is within 2 days and materials are not warehouse-ready.",
          subject: row.name,
          meta: ahead === 0 ? "Install today" : `Install in ${ahead} day${ahead === 1 ? "" : "s"}`,
          owner: null,
          action: "Review material",
          href: row.href,
        });
        continue;
      }
      push(bucket, ahead === 0 ? "today" : "upcoming", {
        id: `inst-${row.id}`,
        priority: ahead === 0 ? "today" : "upcoming",
        title: ahead === 0 ? "Install today" : "Install coming up",
        why: ahead === 0 ? "This install is on today's schedule." : "An install is coming up this week.",
        subject: row.name,
        meta: ahead === 0 ? "Today" : `In ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open job",
        href: row.href,
      });
    }
  }

  if (role === "warehouse") {
    for (const row of signals.installs ?? []) {
      const ahead = daysFromToday(row.scheduledDate, today);
      if (ahead < 0 || ahead > 7) continue;
      const materials = assessMaterialsReadyForSchedule({
        warehouseReadyAt: row.warehouseReadyAt,
        hasMaterialNeed: row.hasMaterialNeed,
      });
      if (materials.ready || !row.hasMaterialNeed) continue;
      push(bucket, ahead <= 2 ? "attention" : "upcoming", {
        id: `wh-${row.id}`,
        priority: ahead <= 2 ? "urgent" : "upcoming",
        title: "Staging needed",
        why: "Required material is not marked warehouse-ready.",
        subject: row.name,
        meta: ahead === 0 ? "Install today" : `Install in ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open warehouse",
        href: "/warehouse",
      });
    }
  }

  if (SCHEDULE_ROLES.includes(role) || role === "sales_manager") {
    for (const row of signals.unscheduled ?? []) {
      if (!owns(role, userId, row.customerOwnerId)) continue;
      const materials = assessMaterialsReadyForSchedule({
        warehouseReadyAt: row.warehouseReadyAt,
        hasMaterialNeed: row.hasMaterialNeed,
      });
      if (!materials.ready) continue;
      const href = SCHEDULE_ROLES.includes(role) ? "/install-scheduler" : row.href;
      push(bucket, "attention", {
        id: `unsched-${row.id}`,
        priority: "today",
        title: "Ready to schedule",
        why: "Materials are ready, or this job has no material to wait on, and the install is not booked.",
        subject: row.name,
        meta: null,
        owner: null,
        action: SCHEDULE_ROLES.includes(role) ? "Open install schedule" : "Open job",
        href,
      });
    }
  }

  if (SERVICE_ROLES.includes(role)) {
    for (const row of signals.callbacks ?? []) {
      const due = parseTime(row.followUpAt);
      const overdue = due == null || due < now.getTime();
      const ahead = due == null ? 0 : daysFromToday(dayStamp(row.followUpAt!), today);
      if (!overdue && ahead > 7) continue;
      const priority: HomePriority = overdue ? "urgent" : "upcoming";
      push(bucket, priority === "urgent" ? "attention" : "upcoming", {
        id: `cb-${row.id}`,
        priority,
        title: "Service issue",
        why: overdue ? "A callback is open and the follow-up is due." : "A callback follow-up is coming up.",
        subject: row.name,
        meta: overdue ? ageLabel(row.followUpAt, now) ?? "Open" : `In ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open service",
        href: row.href,
      });
    }
  }

  for (const row of signals.tasks ?? []) {
    const overdue = isTaskOverdue({ status: row.status, dueAt: row.dueAt, now });
    const dueDay = row.dueAt ? dayStamp(row.dueAt) : null;
    const ahead = dueDay ? daysFromToday(dueDay, today) : null;
    const dueToday = !overdue && ahead === 0;
    if (!overdue && !dueToday && (ahead == null || ahead < 0 || ahead > 7)) continue;
    const priority: HomePriority = overdue ? "urgent" : dueToday ? "today" : "upcoming";
    const section: HomeSectionId = overdue ? "attention" : dueToday ? "today" : "mine";
    push(bucket, section, {
      id: `task-${row.id}`,
      priority,
      title: overdue ? "Task overdue" : dueToday ? "Task due today" : "Your task",
      why: row.title,
      subject: null,
      meta: overdue ? "Past due" : dueToday ? "Due today" : ahead != null ? `In ${ahead} day${ahead === 1 ? "" : "s"}` : null,
      owner: null,
      action: "Open task",
      href: row.href,
    });
  }

  const sections: HomeSection[] = [];
  for (const id of SECTION_ORDER) {
    const items = (bucket.get(id) ?? []).slice(0, SECTION_LIMIT);
    if (!items.length) continue;
    sections.push({ id, label: SECTION_LABEL[id], items });
  }

  const caughtUp = !sections.some((section) => section.id === "today" || section.id === "attention");
  return {
    greeting: greeting(now, signals.firstName),
    sections: caughtUp && sections.length === 0 ? [] : sections,
    caughtUp,
  };
}

export function homeSectionCount(center: HomeCenter, id: HomeSectionId): number {
  return center.sections.find((section) => section.id === id)?.items.length ?? 0;
}

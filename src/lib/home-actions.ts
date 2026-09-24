/**
 * Home action center — presentation only.
 *
 * Priority, section placement, and which button is live are derived from facts
 * the rest of the CRM already stores. This module does not create statuses,
 * balances, or schedule decisions. Callers must pass only records the signed-in
 * role can already open.
 *
 * Canonical gates used here (not invented):
 * - Scheduling is blocked only by assessMaterialsReadyForSchedule. A deposit
 *   on file is not an input to that gate, so deposit and scheduling stay
 *   separate actions when both are true.
 * - A customer follow-up whose stage auto_action is collect_deposit is the
 *   same sales step as an approved estimate with no deposit. Those two facts
 *   for the same customer become one card. Matching the words "deposit" in
 *   the next-action sentence is not enough.
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

export type HomeKind =
  | "followup"
  | "estimate"
  | "deposit"
  | "invoice"
  | "measure"
  | "install"
  | "material"
  | "schedule"
  | "callback"
  | "task"
  | "staging";

export interface HomeItem {
  id: string;
  kind: HomeKind;
  priority: HomePriority;
  title: string;
  why: string;
  subject: string | null;
  meta: string | null;
  owner: string | null;
  /** Primary button. Null when this step is blocked and must not be started. */
  action: string | null;
  href: string | null;
  customerId: string | null;
  jobId: string | null;
  /** Plain next step with no button, used when a canonical gate blocks it. */
  next: string | null;
}

export interface HomeSection {
  id: HomeSectionId;
  label: string;
  /** Highest-priority rows actually rendered. */
  items: HomeItem[];
  /** Full match count, including rows past the display cap. */
  total: number;
  /** Existing queue for this section, only when every row belongs to it. */
  viewAllHref: string | null;
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
  /** Canonical stage auto_action, when the loader has it. */
  stageAction?: string | null;
  ownerId: string | null;
}

export interface HomeEstimate {
  id: string;
  name: string;
  sentAt: string | null;
  totalLabel: string | null;
  customerId?: string | null;
  ownerId: string | null;
}

export interface HomeDeposit {
  id: string;
  name: string;
  approvedAt: string | null;
  amountLabel: string | null;
  customerId?: string | null;
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
  customerId?: string | null;
  customerOwnerId: string | null;
  warehouseReadyAt: string | null;
  hasMaterialNeed: boolean;
  href: string;
}

export interface HomeUnscheduled {
  id: string;
  name: string;
  assigneeId: string | null;
  customerId?: string | null;
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

/**
 * Needs attention order, from existing time and workflow facts.
 * Lower sorts first. This is not a score and not a learned rank.
 * 1. Material blocking an install that is already booked soon.
 * 2. Overdue money the role can already see (invoice, then deposit).
 * 3. Overdue customer follow-up, then overdue service, then overdue task.
 * 4. Sent-estimate follow-up.
 * 5. An install that can be booked (no material gate).
 * Same rank: subject, then id.
 */
const ATTENTION_RANK: Partial<Record<HomeKind, number>> = {
  material: 10,
  staging: 12,
  invoice: 20,
  deposit: 30,
  followup: 40,
  callback: 50,
  task: 60,
  estimate: 70,
  schedule: 80,
};

const SCHEDULE_AFTER_MATERIAL = "Schedule the install after the material is ready.";

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

function card(partial: Omit<HomeItem, "customerId" | "jobId" | "next"> & Partial<Pick<HomeItem, "customerId" | "jobId" | "next">>): HomeItem {
  return {
    customerId: null,
    jobId: null,
    next: null,
    ...partial,
  };
}

function push(bucket: Map<HomeSectionId, HomeItem[]>, section: HomeSectionId, item: HomeItem) {
  const list = bucket.get(section) ?? [];
  if (list.some((row) => row.id === item.id)) return;
  list.push(item);
  bucket.set(section, list);
}

function attentionRank(item: HomeItem): number {
  const base = ATTENTION_RANK[item.kind] ?? 90;
  return base + (item.priority === "urgent" ? 0 : 5);
}

function sortAttention(items: HomeItem[]): HomeItem[] {
  return [...items].sort((a, b) => {
    const rank = attentionRank(a) - attentionRank(b);
    if (rank !== 0) return rank;
    const subject = (a.subject ?? a.title).localeCompare(b.subject ?? b.title);
    if (subject !== 0) return subject;
    return a.id.localeCompare(b.id);
  });
}

/** Drop a collect-deposit follow-up when the deposit card already covers that customer. */
function absorbDepositFollowUps(
  bucket: Map<HomeSectionId, HomeItem[]>,
  followStage: Map<string, string | null>,
) {
  const depositCustomers = new Set<string>();
  for (const list of bucket.values()) {
    for (const item of list) {
      if (item.kind === "deposit" && item.customerId) depositCustomers.add(item.customerId);
    }
  }
  if (!depositCustomers.size) return;
  for (const [section, list] of bucket) {
    bucket.set(
      section,
      list.filter((item) => {
        if (item.kind !== "followup" || !item.customerId) return true;
        if (followStage.get(item.id) !== "collect_deposit") return true;
        return !depositCustomers.has(item.customerId);
      }),
    );
  }
}

/**
 * Deposit collection and booking an install are both allowed. When both cards
 * exist for one customer, say so. Do not tell anyone to collect the deposit
 * before scheduling — that is not the schedule gate.
 */
function clarifyDepositAndSchedule(bucket: Map<HomeSectionId, HomeItem[]>) {
  const scheduleCustomers = new Set<string>();
  const depositCustomers = new Set<string>();
  for (const list of bucket.values()) {
    for (const item of list) {
      if (!item.customerId) continue;
      if (item.kind === "schedule") scheduleCustomers.add(item.customerId);
      if (item.kind === "deposit") depositCustomers.add(item.customerId);
    }
  }
  for (const list of bucket.values()) {
    for (const item of list) {
      if (!item.customerId) continue;
      if (item.kind === "schedule" && depositCustomers.has(item.customerId)) {
        item.why =
          "You can book this install now. Collecting the deposit is a separate step and does not hold the date.";
      }
      if (item.kind === "deposit" && scheduleCustomers.has(item.customerId)) {
        item.why =
          "The estimate is approved and no deposit is on file. Booking the install is a separate step.";
      }
    }
  }
}

function viewAllFor(role: UserRole, items: HomeItem[]): string | null {
  if (!items.length) return null;
  if (!SALES_VIEW.includes(role)) return null;
  const stuckFollowUps = items.every(
    (item) => item.kind === "followup" && item.priority === "urgent" && item.href?.startsWith("/customers/"),
  );
  return stuckFollowUps ? "/customers?stuck=1" : null;
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
 *   The button opens the customer file, where the deposit is recorded.
 * - An open invoice due before today is Urgent. Due today is Today.
 *   Due within 7 days is Upcoming. Other open invoices are not listed.
 * - A measure or install today is Today. An install that still needs material
 *   uses assessMaterialsReadyForSchedule. Within 2 days that is Urgent and
 *   the schedule button is not offered.
 * - An unscheduled job is Needs attention for people who can schedule.
 *   Material not ready: review material, and say the install comes after.
 *   Material ready or no material need: book the install. Deposit does not
 *   remove that button.
 * - An open service callback with a past follow-up, or none, is Urgent.
 *   A future callback within 7 days is Upcoming.
 * - Office tasks use isTaskOverdue. Overdue is Urgent, due today is Today,
 *   and the rest of the week is My work.
 * Each fact is placed in one section. Urgent facts go to Needs attention.
 * Needs attention is then ordered by the rank above and capped at 8 shown
 * rows. The section total is the full match count.
 */
export function buildHomeCenter(signals: HomeSignals): HomeCenter {
  const now = signals.now;
  const today = ymd(now);
  const role = signals.role;
  const userId = signals.userId;
  const bucket = new Map<HomeSectionId, HomeItem[]>();
  const followStage = new Map<string, string | null>();

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
      const id = `follow-${row.id}`;
      followStage.set(id, row.stageAction ?? null);
      push(bucket, priority === "urgent" ? "attention" : priority === "today" ? "today" : "upcoming", card({
        id,
        kind: "followup",
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
        customerId: row.id,
      }));
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
      push(bucket, "attention", card({
        id: `est-${row.id}`,
        kind: "estimate",
        priority,
        title: "Estimate follow-up",
        why: "This estimate was sent and has not been updated.",
        subject: row.name,
        meta: [ageLabel(row.sentAt, now), row.totalLabel].filter(Boolean).join(" · ") || null,
        owner: null,
        action: "Open estimate",
        href: `/estimates/${row.id}`,
        customerId: row.customerId ?? null,
      }));
    }
    for (const row of signals.deposits ?? []) {
      if (!owns(role, userId, row.ownerId)) continue;
      const approved = parseTime(row.approvedAt);
      const age = approved == null ? DEFAULT_DEPOSIT_FOLLOWUP_DAYS : Math.floor((now.getTime() - approved) / 86_400_000);
      const priority: HomePriority = age >= DEFAULT_DEPOSIT_FOLLOWUP_DAYS ? "urgent" : "today";
      const customerId = row.customerId ?? null;
      push(bucket, "attention", card({
        id: `dep-${row.id}`,
        kind: "deposit",
        priority,
        title: "Deposit needed",
        why: "The estimate is approved and no deposit is on file.",
        subject: row.name,
        meta: [row.amountLabel, ageLabel(row.approvedAt, now)].filter(Boolean).join(" · ") || null,
        owner: null,
        action: "Collect deposit",
        href: customerId ? `/customers/${customerId}` : `/estimates/${row.id}`,
        customerId,
      }));
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
      push(bucket, section, card({
        id: `inv-${row.id}`,
        kind: "invoice",
        priority,
        title: ahead < 0 ? "Overdue invoice" : "Invoice due",
        why: ahead < 0 ? "This invoice still has a balance past its due date." : "A balance is due.",
        subject: row.name,
        meta: [row.balanceLabel, row.number ? `#${row.number}` : null].filter(Boolean).join(" · ") || null,
        owner: null,
        action: "Open invoice",
        href: `/invoices/${row.id}`,
      }));
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
      push(bucket, ahead === 0 ? "today" : "upcoming", card({
        id: `meas-${row.id}`,
        kind: "measure",
        priority: ahead === 0 ? "today" : "upcoming",
        title: ahead === 0 ? "Measure today" : "Measure coming up",
        why: ahead === 0 ? "This measure is on today's calendar." : "A measure is on the calendar this week.",
        subject: row.name,
        meta: time,
        owner: row.ownerName,
        action: "Open measure",
        href: row.href,
      }));
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
        push(bucket, "attention", card({
          id: `mat-${row.id}`,
          kind: "material",
          priority: "urgent",
          title: "Material not ready",
          why: ahead === 0
            ? "The install is today. Material for this job is not ready."
            : `The install is in ${ahead} day${ahead === 1 ? "" : "s"}. Material for this job is not ready.`,
          subject: row.name,
          meta: ahead === 0 ? "Install today" : `Install in ${ahead} day${ahead === 1 ? "" : "s"}`,
          owner: null,
          action: "Review material",
          href: row.href,
          customerId: row.customerId ?? null,
          jobId: row.id,
        }));
        continue;
      }
      push(bucket, ahead === 0 ? "today" : "upcoming", card({
        id: `inst-${row.id}`,
        kind: "install",
        priority: ahead === 0 ? "today" : "upcoming",
        title: ahead === 0 ? "Install today" : "Install coming up",
        why: ahead === 0 ? "This install is on today's schedule." : "An install is coming up this week.",
        subject: row.name,
        meta: ahead === 0 ? "Today" : `In ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open job",
        href: row.href,
        customerId: row.customerId ?? null,
        jobId: row.id,
      }));
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
      push(bucket, ahead <= 2 ? "attention" : "upcoming", card({
        id: `wh-${row.id}`,
        kind: "staging",
        priority: ahead <= 2 ? "urgent" : "upcoming",
        title: "Staging needed",
        why: "Material for this install still needs to be staged.",
        subject: row.name,
        meta: ahead === 0 ? "Install today" : `Install in ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open warehouse",
        href: "/warehouse",
        customerId: row.customerId ?? null,
        jobId: row.id,
      }));
    }
  }

  if (SCHEDULE_ROLES.includes(role) || role === "sales_manager") {
    for (const row of signals.unscheduled ?? []) {
      if (!owns(role, userId, row.customerOwnerId)) continue;
      const materials = assessMaterialsReadyForSchedule({
        warehouseReadyAt: row.warehouseReadyAt,
        hasMaterialNeed: row.hasMaterialNeed,
      });
      if (!materials.ready) {
        push(bucket, "attention", card({
          id: `mat-${row.id}`,
          kind: "material",
          priority: "urgent",
          title: "Material not ready",
          why: "This job still needs material. Do not book the install until it is ready.",
          subject: row.name,
          meta: null,
          owner: null,
          action: "Review material",
          href: row.href,
          customerId: row.customerId ?? null,
          jobId: row.id,
          next: SCHEDULE_AFTER_MATERIAL,
        }));
        continue;
      }
      push(bucket, "attention", card({
        id: `unsched-${row.id}`,
        kind: "schedule",
        priority: "today",
        title: "Install not booked",
        why: "This install is not booked yet. You can schedule it now.",
        subject: row.name,
        meta: null,
        owner: null,
        action: "Schedule install",
        href: row.href,
        customerId: row.customerId ?? null,
        jobId: row.id,
      }));
    }
  }

  if (SERVICE_ROLES.includes(role)) {
    for (const row of signals.callbacks ?? []) {
      const due = parseTime(row.followUpAt);
      const overdue = due == null || due < now.getTime();
      const ahead = due == null ? 0 : daysFromToday(dayStamp(row.followUpAt!), today);
      if (!overdue && ahead > 7) continue;
      const priority: HomePriority = overdue ? "urgent" : "upcoming";
      push(bucket, priority === "urgent" ? "attention" : "upcoming", card({
        id: `cb-${row.id}`,
        kind: "callback",
        priority,
        title: "Service issue",
        why: overdue ? "A callback is open and the follow-up is due." : "A callback follow-up is coming up.",
        subject: row.name,
        meta: overdue ? ageLabel(row.followUpAt, now) ?? "Open" : `In ${ahead} day${ahead === 1 ? "" : "s"}`,
        owner: null,
        action: "Open service",
        href: row.href,
      }));
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
    push(bucket, section, card({
      id: `task-${row.id}`,
      kind: "task",
      priority,
      title: overdue ? "Task overdue" : dueToday ? "Task due today" : "Your task",
      why: row.title,
      subject: null,
      meta: overdue ? "Past due" : dueToday ? "Due today" : ahead != null ? `In ${ahead} day${ahead === 1 ? "" : "s"}` : null,
      owner: null,
      action: "Open task",
      href: row.href,
    }));
  }

  absorbDepositFollowUps(bucket, followStage);
  clarifyDepositAndSchedule(bucket);

  const sections: HomeSection[] = [];
  for (const id of SECTION_ORDER) {
    const all = id === "attention" ? sortAttention(bucket.get(id) ?? []) : (bucket.get(id) ?? []);
    const filled = all.filter((item) => item.title);
    if (!filled.length) continue;
    sections.push({
      id,
      label: SECTION_LABEL[id],
      items: filled.slice(0, SECTION_LIMIT),
      total: filled.length,
      viewAllHref: filled.length > SECTION_LIMIT ? viewAllFor(role, filled) : null,
    });
  }

  const caughtUp = !sections.some((section) => section.id === "today" || section.id === "attention");
  return {
    greeting: greeting(now, signals.firstName),
    sections: caughtUp && sections.length === 0 ? [] : sections,
    caughtUp,
  };
}

export function homeSectionCount(center: HomeCenter, id: HomeSectionId): number {
  return center.sections.find((section) => section.id === id)?.total ?? 0;
}

/**
 * Record action center — presentation only.
 *
 * Turns facts the pages already have into one status, one primary action, and
 * any independent work that must not look like a prerequisite.
 *
 * Scheduling uses assessMaterialsReadyForSchedule. A missing deposit is not an
 * input to that gate. Purchasing gap is operational attention from
 * assessJobOperationalState; it is not the schedule write gate, so this module
 * does not hide Schedule install because of it.
 */
import type { UserRole } from "@/lib/types";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import type { JobOperationalState } from "@/lib/job-operational-state";
import {
  DEFAULT_ESTIMATE_FOLLOWUP_DAYS,
  hasActiveDepositOnFile,
  shouldCreateEstimateFollowup,
} from "@/lib/ops-followup";
import { isTaskOverdue } from "@/lib/office-task";

export interface RecordLink {
  label: string;
  href: string;
}

export interface RecordActionCenterModel {
  situation: string[];
  attention: string | null;
  blocker: string | null;
  also: string | null;
  primary: RecordLink | null;
  secondary: RecordLink[];
  history: string[];
  quiet: string | null;
}

const MONEY_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];
const SCHEDULE_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman", "scheduler"];
const KNOWN_ESTIMATE = new Set(["draft", "sent", "approved", "declined", "changes_requested"]);
const KNOWN_JOB = new Set(["unscheduled", "scheduled", "in_progress", "completed", "cancelled"]);

const EMPTY: RecordActionCenterModel = {
  situation: [],
  attention: null,
  blocker: null,
  also: null,
  primary: null,
  secondary: [],
  history: [],
  quiet: null,
};

function money(role: UserRole) {
  return MONEY_ROLES.includes(role);
}
function canSchedule(role: UserRole) {
  return SCHEDULE_ROLES.includes(role);
}

function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function daysSince(value: string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

function daysUntil(dateYmd: string | null, todayYmd: string): number | null {
  if (!dateYmd) return null;
  const day = dateYmd.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const a = Date.parse(`${todayYmd}T00:00:00Z`);
  const b = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function jobLabel(title: string | null | undefined, fallback = "This job"): string {
  const name = title?.trim();
  return name ? name : fallback;
}

function capHistory(lines: { at: string; text: string }[]): string[] {
  return lines
    .filter((row) => row.at && row.text)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-5)
    .map((row) => row.text);
}

export interface CustomerActionEstimate {
  id: string;
  status: string;
  sentAt?: string | null;
  approvedAt?: string | null;
  approvalStale?: boolean;
}

export interface CustomerActionJob {
  id: string;
  title: string | null;
  status: string;
  scheduledDate?: string | null;
  warehouseReadyAt?: string | null;
  hasMaterialNeed: boolean;
  createdAt?: string | null;
}

export interface CustomerActionInvoice {
  id: string;
  number?: string | null;
  dueAt?: string | null;
  label?: string | null;
}

export interface CustomerActionCallback {
  jobId?: string | null;
  jobTitle?: string | null;
}

export interface CustomerActionTask {
  title: string;
  dueAt?: string | null;
  status?: string | null;
  sourceKey?: string | null;
}

export function buildCustomerActionCenter(input: {
  now: Date;
  role: UserRole;
  customerId: string;
  stageName?: string | null;
  stageAction?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  /** Null when this role must not be told about deposits. */
  depositOnFile?: boolean | null;
  estimates?: CustomerActionEstimate[];
  jobs?: CustomerActionJob[];
  openInvoices?: CustomerActionInvoice[];
  callbacks?: CustomerActionCallback[];
  tasks?: CustomerActionTask[];
}): RecordActionCenterModel {
  if (input.role === "customer" || input.role === "crew" || input.role === "warehouse") {
    return { ...EMPTY, quiet: "This record is not part of your work." };
  }
  const today = input.now.toISOString().slice(0, 10);
  const seeMoney = money(input.role);
  const schedule = canSchedule(input.role);
  const estimates = input.estimates ?? [];
  const jobs = (input.jobs ?? []).filter((job) => job.status !== "cancelled" && job.id);
  const approved = estimates.filter((row) => row.status === "approved" && !row.approvalStale);
  const depositNeeded =
    seeMoney && input.depositOnFile === false && approved.length > 0;

  const materialJobs = jobs.filter((job) => {
    if (job.status === "completed") return false;
    const ready = assessMaterialsReadyForSchedule({
      warehouseReadyAt: job.warehouseReadyAt,
      hasMaterialNeed: job.hasMaterialNeed,
    });
    if (ready.ready) return false;
    const ahead = daysUntil(job.scheduledDate ?? null, today);
    const unscheduled = job.status === "unscheduled" || !job.scheduledDate;
    return unscheduled || (ahead != null && ahead >= 0 && ahead <= 2);
  });
  const bookable = jobs.filter((job) => {
    if (job.status !== "unscheduled" && job.scheduledDate) return false;
    if (job.status === "completed" || job.status === "in_progress" || job.status === "scheduled") return false;
    if (job.status !== "unscheduled" && job.status !== "") return false;
    return assessMaterialsReadyForSchedule({
      warehouseReadyAt: job.warehouseReadyAt,
      hasMaterialNeed: job.hasMaterialNeed,
    }).ready;
  });

  const situation: string[] = [];
  if (input.stageName) situation.push(input.stageName);
  if (approved.length === 1) situation.push("Estimate approved");
  else if (approved.length > 1) situation.push(`${approved.length} estimates approved`);
  const sent = estimates.filter((row) => shouldCreateEstimateFollowup(row.status));
  if (sent.length && !approved.length) situation.push(sent.length === 1 ? "Estimate sent" : `${sent.length} estimates sent`);
  if (depositNeeded) situation.push("Deposit not collected");
  if (bookable.length === 1) situation.push(`${jobLabel(bookable[0].title)} is not booked`);
  else if (bookable.length > 1) situation.push(`${bookable.length} installs are not booked`);

  let blocker: string | null = null;
  let primary: RecordLink | null = null;
  let also: string | null = null;
  const secondary: RecordLink[] = [];

  if (materialJobs.length) {
    const job = materialJobs[0];
    const name = jobLabel(job.title);
    blocker = `${name} is not warehouse-ready, so that installation cannot be scheduled yet.`;
    primary = { label: "Review material", href: `/jobs/${job.id}` };
    also = "Schedule that install after the material is ready.";
  }

  if (depositNeeded) {
    const link = { label: "Collect deposit", href: `/customers/${input.customerId}` };
    if (!primary) primary = link;
    else secondary.push(link);
    if (!blocker) {
      also = bookable.length
        ? "Collecting the deposit does not hold the installation date."
        : null;
    }
  }

  if (schedule && bookable.length && !materialJobs.some((job) => job.id === bookable[0]?.id)) {
    const job = bookable[0];
    const link = { label: "Schedule install", href: `/jobs/${job.id}` };
    if (!primary) primary = link;
    else if (!secondary.some((row) => row.href === link.href && row.label === link.label)) secondary.push(link);
  }

  if (seeMoney) {
    const overdue = (input.openInvoices ?? []).filter((row) => {
      const ahead = daysUntil(row.dueAt ?? null, today);
      return ahead != null && ahead < 0;
    });
    if (overdue.length === 1) {
      const row = overdue[0];
      const name = row.label?.trim() || (row.number ? `Invoice ${row.number}` : "An invoice");
      if (!primary) primary = { label: "Open invoice", href: `/invoices/${row.id}` };
      else secondary.push({ label: `Open ${name}`, href: `/invoices/${row.id}` });
    } else if (overdue.length > 1) {
      secondary.push({ label: `Open invoices (${overdue.length})`, href: `/customers/${input.customerId}` });
    }
  }

  const callback = (input.callbacks ?? [])[0];
  if (callback) {
    const name = callback.jobTitle?.trim();
    const line = name ? `${name} has an open service issue.` : "A service issue is open.";
    if (!blocker) also = also ? `${also} ${line}` : line;
    secondary.push({ label: "Open service", href: "/service" });
  }

  const followDue = sent.some((row) => {
    const age = daysSince(row.sentAt, input.now);
    return age != null && age >= DEFAULT_ESTIMATE_FOLLOWUP_DAYS;
  });
  const stuck =
    !!input.nextActionDue && new Date(input.nextActionDue).getTime() < input.now.getTime();
  const depositStage = input.stageAction === "collect_deposit" && depositNeeded;
  if (stuck && !depositStage && seeMoney) {
    const reason = input.nextAction?.trim();
    if (!primary) {
      primary = { label: "Open follow-up", href: `/customers/${input.customerId}` };
    }
    if (!blocker && reason) also = also ?? reason;
  } else if (followDue && seeMoney && !depositNeeded && !primary) {
    primary = { label: "Follow up", href: `/customers/${input.customerId}` };
  }

  const taskNoise = new Set<string>();
  if (depositNeeded) taskNoise.add("deposit_due:");
  if (followDue || sent.length) taskNoise.add("estimate_followup:");
  if (callback) taskNoise.add("service_callback:");
  const extraTask = (input.tasks ?? []).find((task) => {
    const key = task.sourceKey ?? "";
    if ([...taskNoise].some((prefix) => key.startsWith(prefix))) return false;
    return isTaskOverdue({ status: task.status ?? "open", dueAt: task.dueAt ?? null, now: input.now });
  });
  if (extraTask && seeMoney) {
    secondary.push({ label: "Open task", href: `/customers/${input.customerId}` });
  }

  const history = capHistory([
    ...estimates.flatMap((row) => {
      const lines: { at: string; text: string }[] = [];
      if (row.sentAt) lines.push({ at: row.sentAt, text: `Estimate sent ${shortDate(row.sentAt)}` });
      if (row.approvedAt) lines.push({ at: row.approvedAt, text: `Estimate approved ${shortDate(row.approvedAt)}` });
      return lines;
    }),
    ...jobs.flatMap((job) => {
      const lines: { at: string; text: string }[] = [];
      const name = jobLabel(job.title, "Job");
      if (job.createdAt) lines.push({ at: job.createdAt, text: `${name} created ${shortDate(job.createdAt)}` });
      if (job.warehouseReadyAt) lines.push({ at: job.warehouseReadyAt, text: `${name} material ready ${shortDate(job.warehouseReadyAt)}` });
      if (job.scheduledDate) lines.push({ at: job.scheduledDate, text: `${name} booked ${shortDate(job.scheduledDate)}` });
      return lines;
    }),
  ]);

  const attention = blocker
    ? "Material is not ready."
    : depositNeeded
      ? "Deposit has not been collected."
      : primary
        ? primary.label
        : null;

  const quiet =
    primary || blocker || secondary.length
      ? null
      : schedule && !seeMoney
        ? "Nothing on this customer needs scheduling."
        : "You're caught up on this customer.";

  if (depositNeeded && !situation.includes("Deposit not collected")) situation.push("Deposit not collected");

  return {
    situation: situation.slice(0, 4),
    attention,
    blocker,
    also,
    primary,
    secondary: secondary.slice(0, 2),
    history,
    quiet,
  };
}

export function buildEstimateActionCenter(input: {
  now: Date;
  role: UserRole;
  estimateId: string;
  customerId: string | null;
  status: string;
  sentAt?: string | null;
  approvedAt?: string | null;
  viewedAt?: string | null;
  approvalStale?: boolean;
  hasOptions?: boolean;
  hasEmail?: boolean;
  depositOnFile?: boolean | null;
  linkedJob?: { id: string; title?: string | null; bookable?: boolean; materialBlocked?: boolean } | null;
}): RecordActionCenterModel {
  if (input.role === "customer" || input.role === "crew" || input.role === "warehouse") {
    return { ...EMPTY, quiet: "This estimate is not part of your work." };
  }
  if (!KNOWN_ESTIMATE.has(input.status)) {
    return {
      ...EMPTY,
      situation: ["Status not recognized"],
      quiet: "This estimate status is not one the office uses. No next step is shown.",
    };
  }
  const seeMoney = money(input.role);
  const schedule = canSchedule(input.role);
  const history = capHistory(
    [
      input.sentAt ? { at: input.sentAt, text: `Sent ${shortDate(input.sentAt)}` } : null,
      input.viewedAt ? { at: input.viewedAt, text: `Viewed ${shortDate(input.viewedAt)}` } : null,
      input.approvedAt ? { at: input.approvedAt, text: `Approved ${shortDate(input.approvedAt)}` } : null,
    ].filter((row): row is { at: string; text: string } => !!row && !!row.text),
  );
  const customerHref = input.customerId ? `/customers/${input.customerId}` : null;
  const job = input.linkedJob?.id ? input.linkedJob : null;

  if (input.approvalStale) {
    return {
      situation: ["Approval is out of date"],
      attention: "The customer needs to approve the revised estimate.",
      blocker: "A new job cannot be created from this estimate until it is approved again.",
      also: job ? `${jobLabel(job.title)} already exists and was not changed.` : null,
      primary: null,
      secondary: job ? [{ label: "Open job", href: `/jobs/${job.id}` }] : [],
      history,
      quiet: null,
    };
  }

  if (input.status === "draft") {
    if (input.hasOptions === false) {
      return {
        situation: ["Draft"],
        attention: "Add a priced option before this estimate can be sent.",
        blocker: null,
        also: null,
        primary: null,
        secondary: [],
        history,
        quiet: null,
      };
    }
    return {
      situation: ["Draft"],
      attention: input.hasEmail === false ? "No email is on file, so this cannot be emailed yet." : "This estimate has not been sent.",
      blocker: null,
      also: null,
      primary: { label: input.hasEmail === false ? "Add an email" : "Send estimate", href: "#estimate-next" },
      secondary: [],
      history,
      quiet: null,
    };
  }

  if (input.status === "declined") {
    return {
      situation: ["Declined"],
      attention: null,
      blocker: null,
      also: null,
      primary: null,
      secondary: customerHref ? [{ label: "Open customer", href: customerHref }] : [],
      history,
      quiet: "The customer declined this estimate.",
    };
  }

  if (input.status === "changes_requested") {
    return {
      situation: ["Changes requested"],
      attention: "The customer asked for changes.",
      blocker: null,
      also: null,
      primary: { label: "Review estimate", href: "#estimate-next" },
      secondary: [],
      history,
      quiet: null,
    };
  }

  if (input.status === "sent") {
    const age = daysSince(input.sentAt, input.now);
    const due = age != null && age >= DEFAULT_ESTIMATE_FOLLOWUP_DAYS;
    const when = shortDate(input.sentAt);
    return {
      situation: [when ? `Sent ${when}` : "Sent to customer"],
      attention: due ? "Follow up with the customer." : null,
      blocker: null,
      also: null,
      primary: due && customerHref ? { label: "Follow up", href: customerHref } : { label: "Review estimate", href: "#estimate-next" },
      secondary: [],
      history,
      quiet: due ? null : "No follow-up is due yet.",
    };
  }

  const depositNeeded = seeMoney && input.depositOnFile === false;
  const materialBlocked = !!job?.materialBlocked;
  const bookable = !!job?.bookable && !materialBlocked;
  const situation = ["Approved"];
  if (depositNeeded) situation.push("Deposit not collected");
  if (bookable) situation.push("Install can be scheduled");
  if (materialBlocked) situation.push("Material is not ready");

  let primary: RecordLink | null = null;
  const secondary: RecordLink[] = [];
  let also: string | null = null;
  let blocker: string | null = null;

  if (materialBlocked && job) {
    blocker = `${jobLabel(job.title)} is not warehouse-ready, so the installation cannot be scheduled yet.`;
    primary = schedule ? { label: "Review material", href: `/jobs/${job.id}` } : null;
  }
  if (depositNeeded && customerHref) {
    const link = { label: "Collect deposit", href: customerHref };
    if (!primary) primary = link;
    else secondary.push(link);
  }
  if (bookable && job && schedule) {
    const link = { label: "Schedule install", href: `/jobs/${job.id}` };
    if (!primary) primary = link;
    else secondary.push(link);
    also = depositNeeded ? "Collecting the deposit does not hold the installation date." : "Material is ready and the installation has not been booked.";
  }
  if (job && !primary && !materialBlocked) {
    secondary.push({ label: "Open job", href: `/jobs/${job.id}` });
  }

  return {
    situation,
    attention: depositNeeded ? "No deposit is on file." : materialBlocked ? "Material is not ready." : bookable ? "Install can be scheduled now." : null,
    blocker,
    also,
    primary,
    secondary: secondary.slice(0, 2),
    history,
    quiet: primary || blocker ? null : "This estimate is approved and nothing else is waiting on it.",
  };
}

export function buildJobActionCenter(input: {
  now: Date;
  role: UserRole;
  jobId: string;
  title: string | null;
  status: string;
  scheduledDate?: string | null;
  warehouseReadyAt?: string | null;
  hasMaterialNeed: boolean;
  createdAt?: string | null;
  completedAt?: string | null;
  ops: JobOperationalState | null;
  openBalance?: number | null;
  invoiceHref?: string | null;
  hasOpenCallback?: boolean;
  crewCollectsBalance?: boolean;
}): RecordActionCenterModel {
  const role = input.role;
  if (role === "customer") return { ...EMPTY, quiet: "Use the customer portal for this job." };
  if (!KNOWN_JOB.has(input.status)) {
    return {
      ...EMPTY,
      situation: ["Status not recognized"],
      quiet: "This job status is not one the office uses. No next step is shown.",
    };
  }
  const seeMoney = money(role) || (role === "crew" && input.crewCollectsBalance === true);
  const schedule = canSchedule(role);
  const warehouse = role === "warehouse";
  const name = jobLabel(input.title);
  const materials = assessMaterialsReadyForSchedule({
    warehouseReadyAt: input.warehouseReadyAt,
    hasMaterialNeed: input.hasMaterialNeed,
  });
  const today = input.now.toISOString().slice(0, 10);
  const ahead = daysUntil(input.scheduledDate ?? null, today);
  const near = ahead != null && ahead >= 0 && ahead <= 2;
  const when = shortDate(input.scheduledDate);
  const history = capHistory(
    [
      input.createdAt ? { at: input.createdAt, text: `Job created ${shortDate(input.createdAt)}` } : null,
      input.warehouseReadyAt ? { at: input.warehouseReadyAt, text: `Material ready ${shortDate(input.warehouseReadyAt)}` } : null,
      input.scheduledDate ? { at: input.scheduledDate, text: `Install booked ${shortDate(input.scheduledDate)}` } : null,
      input.completedAt ? { at: input.completedAt, text: `Install completed ${shortDate(input.completedAt)}` } : null,
    ].filter((row): row is { at: string; text: string } => !!row && !!row.text),
  );

  if (warehouse) {
    if (!input.hasMaterialNeed || materials.ready) {
      return { situation: ["Nothing to stage"], attention: null, blocker: null, also: null, primary: null, secondary: [], history, quiet: "Nothing is waiting on the warehouse for this job." };
    }
    return {
      situation: ["Material is not ready"],
      attention: "Material still needs to be staged.",
      blocker: near || !input.scheduledDate ? `${name} is not warehouse-ready.` : null,
      also: null,
      primary: { label: "Open warehouse", href: "/warehouse" },
      secondary: [],
      history,
      quiet: null,
    };
  }

  if (input.status === "cancelled" || input.ops?.blockerCode === "cancelled") {
    return { situation: ["Cancelled"], attention: null, blocker: null, also: null, primary: null, secondary: [], history, quiet: "This job is cancelled." };
  }

  if (input.ops?.blockerCode === "manual_hold") {
    return {
      situation: ["On hold"],
      attention: null,
      blocker: input.ops.explanation || "This job is on hold.",
      also: null,
      primary: null,
      secondary: [],
      history,
      quiet: null,
    };
  }

  const callback = input.hasOpenCallback || input.ops?.blockerCode === "open_service_callback";
  if (input.status === "completed") {
    const balance = seeMoney && (input.openBalance ?? 0) > 0.5;
    return {
      situation: ["Install complete"],
      attention: callback ? "A service issue is still open." : balance ? "A balance is still open." : null,
      blocker: callback ? "The install is finished, but a service issue is still open." : null,
      also: !callback && balance ? "The remaining balance does not change the completed install." : null,
      primary: callback ? { label: "Open service", href: "/service" } : balance && input.invoiceHref ? { label: "Open invoice", href: input.invoiceHref } : null,
      secondary: callback && balance && input.invoiceHref ? [{ label: "Open invoice", href: input.invoiceHref }] : [],
      history,
      quiet: callback || balance ? null : "This job is on track.",
    };
  }

  const purchasing = input.ops?.blockerCode === "needs_purchasing";
  const materialBlocksSchedule = !materials.ready && (input.status === "unscheduled" || !input.scheduledDate || near);

  if (materialBlocksSchedule) {
    const blocker = input.scheduledDate
      ? `${name} is not warehouse-ready. The install date is already booked.`
      : `${name} is not warehouse-ready, so the installation cannot be scheduled yet.`;
    const primary = warehouse
      ? { label: "Open warehouse", href: "/warehouse" }
      : { label: "Review material", href: `/jobs/${input.jobId}` };
    return {
      situation: ["Waiting on material"],
      attention: "Material is not ready.",
      blocker,
      also: purchasing ? "Purchasing coverage is also still open. That does not change the material gate." : input.scheduledDate ? null : "Schedule the install after the material is ready.",
      primary: role === "crew" ? primary : primary,
      secondary: [],
      history,
      quiet: null,
    };
  }

  if ((input.status === "unscheduled" || !input.scheduledDate) && materials.ready && input.status !== "in_progress") {
    return {
      situation: ["Ready to schedule"],
      attention: null,
      blocker: null,
      also: purchasing
        ? "Purchasing still has a coverage gap. Booking the install only checks that material is warehouse-ready, and this job passes that check."
        : input.hasMaterialNeed
          ? "Material is ready and the installation has not been booked."
          : "This job has no material to wait on, and the installation has not been booked.",
      primary: schedule ? { label: "Schedule install", href: `/jobs/${input.jobId}` } : null,
      secondary: [],
      history,
      quiet: schedule ? null : "This install is not booked. Scheduling is handled by the office.",
    };
  }

  if (callback && role !== "crew") {
    return {
      situation: [when ? `Install ${when}` : "Install booked"],
      attention: "A service issue is open.",
      blocker: null,
      also: "The service issue is separate from the install date.",
      primary: { label: "Open service", href: "/service" },
      secondary: [],
      history,
      quiet: null,
    };
  }

  const balance = seeMoney && (input.openBalance ?? 0) > 0.5 && input.ops?.blockerCode === "payment_due";
  if (input.scheduledDate && when) {
    return {
      situation: [`Installation scheduled for ${when}`],
      attention: balance ? "A balance is still open." : null,
      blocker: null,
      also: balance ? "The open balance does not take this install off the schedule." : null,
      primary: balance && input.invoiceHref ? { label: "Open invoice", href: input.invoiceHref } : null,
      secondary: [],
      history,
      quiet: balance ? null : "This job is on track.",
    };
  }

  return {
    situation: [input.ops?.blockerLabel || "In progress"],
    attention: null,
    blocker: null,
    also: input.ops?.explanation ?? null,
    primary: null,
    secondary: [],
    history,
    quiet: "No action is needed right now.",
  };
}

export function depositOnFileFromSummary(summary: { available: number; applied: number } | null | undefined): boolean {
  if (!summary) return false;
  return hasActiveDepositOnFile({ availableDeposit: summary.available, appliedDeposit: summary.applied });
}

/**
 * The job, as a checklist.
 *
 * The guided flow showed ONE step at a time with bespoke UI for each. That
 * answers "what do I do next" and nothing else — you couldn't see how far along
 * a job was, what had already happened, or get back to the work order without
 * hunting through tabs.
 *
 * This is the same pipeline expressed as a list you can read at a glance and
 * click into at any point: every step, whether it's done, and where it lives.
 * Derived entirely from real records — no new status to keep in step.
 */

export type ChecklistState = "done" | "current" | "todo" | "skipped";

export interface ChecklistStep {
  key: string;
  /** What you actually do, in the imperative. */
  title: string;
  /** The artefact this step produces or opens. */
  href: string | null;
  linkLabel: string | null;
  state: ChecklistState;
  /** Shown under the title when it matters — a date, an amount, a blocker. */
  detail: string | null;
  /** Everything else worth clicking from this step. The primary link opens the
   *  step; these are the neighbours you reach for while you're there. */
  extras: { label: string; href: string }[];
}

export interface ChecklistInput {
  customerId: string;
  /** Estimates, newest-relevant first. */
  estimate: { id: string; status: string } | null;
  approvedEstimateId: string | null;
  job: {
    id: string;
    status: string;
    scheduledDate: string | null;
    warehouseReadyAt: string | null;
    warehouseSubmittedAt: string | null;
    closedOutAt: string | null;
  } | null;
  /** Any invoice, and whether money has landed. */
  invoice: { id: string; balance: number } | null;
  depositPaid: boolean;
  balanceOutstanding: number;
  hasActivity: boolean;
  estimateBooked: boolean;
  /** Committed (issued) purchase orders exist for this job. */
  materialsOrdered: boolean;
  satisfactionSigned: boolean;
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Build the checklist.
 *
 * A step is `done` when the RECORD proving it exists — not when someone ticked
 * something. `current` is the first step that isn't done, so there is exactly
 * one, always. Everything after it is `todo`.
 */
export function buildChecklist(i: ChecklistInput): ChecklistStep[] {
  const est = i.estimate;
  const job = i.job;

  const raw: Omit<ChecklistStep, "state" | "extras">[] = [
    {
      key: "contact",
      title: "Talk to the customer",
      href: `/customers/${i.customerId}#activity`,
      linkLabel: "Log a call or note",
      detail: null,
    },
    {
      key: "measure",
      title: "Book the estimate visit",
      // Opens the estimate scheduler itself, not just the tab it lives on —
      // "#overview" scrolled you to the right screen and left you hunting for
      // the button.
      href: `/customers/${i.customerId}?schedule=estimate#overview`,
      linkLabel: "Schedule it",
      detail: null,
    },
    {
      key: "build",
      title: "Build the estimate",
      href: est ? `/estimates/${est.id}/edit` : `/estimates/start?customer=${i.customerId}`,
      linkLabel: est ? "Open the builder" : "Start an estimate",
      detail: null,
    },
    {
      key: "send",
      title: "Send it to the customer",
      href: est ? `/estimates/${est.id}` : null,
      linkLabel: est ? "Review & send" : null,
      detail: null,
    },
    {
      key: "approve",
      title: "Get it approved",
      href: est ? `/estimates/${est.id}` : null,
      linkLabel: est ? "Open the estimate" : null,
      detail: null,
    },
    {
      key: "deposit",
      title: "Collect the deposit",
      href: i.invoice
        ? `/invoices/${i.invoice.id}`
        : i.approvedEstimateId
          ? `/estimates/${i.approvedEstimateId}/invoice`
          : null,
      linkLabel: i.invoice ? "Open the invoice" : "Raise the deposit invoice",
      detail: null,
    },
    {
      key: "order",
      title: "Order the materials",
      href: i.approvedEstimateId ? `/estimates/${i.approvedEstimateId}/order` : null,
      linkLabel: "Review & raise POs",
      detail: null,
    },
    {
      key: "workorder",
      title: "Check the work order",
      href: job ? `/jobs/${job.id}` : null,
      linkLabel: job ? "Open the work order" : null,
      detail: null,
    },
    {
      key: "staging",
      title: "Send the staging sheet to the warehouse",
      href: job ? `/jobs/${job.id}/staging-sheet` : null,
      linkLabel: job ? "Open the staging sheet" : null,
      detail: null,
    },
    {
      key: "schedule",
      title: "Schedule the install",
      href: job ? `/jobs/${job.id}` : null,
      linkLabel: job ? "Book the date" : null,
      detail: null,
    },
    {
      key: "install",
      title: "Do the install",
      href: job ? `/jobs/${job.id}` : null,
      linkLabel: job ? "Open the work order" : null,
      detail: null,
    },
    {
      key: "signoff",
      title: "Get the customer's sign-off",
      href: job ? `/jobs/${job.id}` : null,
      linkLabel: job ? "Capture sign-off" : null,
      detail: null,
    },
    {
      key: "balance",
      title: "Collect the balance",
      href: i.invoice ? `/invoices/${i.invoice.id}` : null,
      linkLabel: i.invoice ? "Open the invoice" : null,
      detail: null,
    },
    {
      key: "closeout",
      title: "Close the job out",
      href: job ? `/jobs/${job.id}/closeout` : null,
      linkLabel: job ? "Record what it cost" : null,
      detail: null,
    },
  ];

  // What the records prove, step by step.
  const done: Record<string, boolean> = {
    contact: i.hasActivity,
    measure: i.estimateBooked || !!est,
    build: !!est,
    send: !!est && (est.status === "sent" || est.status === "approved"),
    approve: !!i.approvedEstimateId,
    deposit: i.depositPaid,
    order: i.materialsOrdered,
    workorder: !!job,
    staging: !!job?.warehouseReadyAt,
    schedule: !!job?.scheduledDate,
    install: job?.status === "completed",
    signoff: i.satisfactionSigned,
    balance: !!i.invoice && i.balanceOutstanding <= 0.005,
    closeout: !!job?.closedOutAt,
  };

  const detail: Record<string, string | null> = {
    contact: i.hasActivity ? null : "Nobody has logged a call or note yet",
    measure: i.estimateBooked ? null : est ? null : "No visit booked yet",
    send: est?.status === "draft" ? "Still a draft" : null,
    deposit: i.depositPaid
      ? null
      : i.invoice
        ? `${money(i.invoice.balance)} outstanding`
        : "No invoice raised yet",
    order: i.materialsOrdered ? null : "No purchase order issued yet",
    staging: job?.warehouseReadyAt
      ? "Warehouse marked it staged"
      : job?.warehouseSubmittedAt
        ? "With the warehouse"
        : job
          ? "Not sent to the warehouse yet"
          : null,
    schedule: job?.scheduledDate ? `Booked ${job.scheduledDate}` : null,
    balance:
      i.balanceOutstanding > 0.005 ? `${money(i.balanceOutstanding)} outstanding` : null,
    closeout: job?.closedOutAt ? null : "Actual costs not recorded",
  };

  /**
   * Real jobs don't finish in order.
   *
   * A deposit gets waived, a quote is approved on the phone and never marked,
   * material is ordered before the paperwork catches up. Treating "the first
   * unticked box" as the next action produced nonsense — "Next: collect the
   * deposit" on a job that was already installed.
   *
   * So: find how far the job has ACTUALLY got (the last completed step), and
   * the next action is the first open step after that. Anything still open
   * BEHIND that point wasn't next — it was passed over, and saying so is the
   * useful part. "You never collected a deposit on this one" is worth knowing;
   * burying it as a to-do is not.
   */
  // The other things you click from a given step. Kept here, with the steps,
  // so there is one place that knows what a step is about.
  const extras: Record<string, { label: string; href: string }[]> = {
    build: est
      ? [{ label: "Guided questionnaire", href: `/estimates/guided?customer=${i.customerId}` }]
      : [],
    send: est ? [{ label: "Customer copy", href: `/estimates/${est.id}?preview=1` }] : [],
    approve: est ? [{ label: "Customer copy", href: `/estimates/${est.id}?preview=1` }] : [],
    order: [{ label: "All purchase orders", href: "/purchase-orders" }],
    workorder: job ? [{ label: "Staging sheet", href: `/jobs/${job.id}/staging-sheet` }] : [],
    staging: job ? [{ label: "Warehouse board", href: "/warehouse" }] : [],
    schedule: job ? [{ label: "Install calendar", href: "/jobs/calendar" }] : [],
    install: job ? [{ label: "Staging sheet", href: `/jobs/${job.id}/staging-sheet` }] : [],
    balance: i.invoice ? [{ label: "Print invoice", href: `/invoices/${i.invoice.id}?print=1` }] : [],
    closeout: job ? [{ label: "Installer bill", href: `/jobs/${job.id}/bill` }] : [],
  };

  const lastDone = raw.reduce((acc, s, idx) => (done[s.key] ? idx : acc), -1);
  const currentIdx = raw.findIndex((s, idx) => !done[s.key] && idx > lastDone);

  return raw.map((s, idx) => ({
    ...s,
    detail: detail[s.key] ?? null,
    extras: extras[s.key] ?? [],
    state: done[s.key]
      ? "done"
      : idx === currentIdx
        ? "current"
        : idx < lastDone
          ? "skipped"
          : "todo",
  }));
}

/** How far through, for the progress line. */
export function checklistProgress(steps: ChecklistStep[]): {
  done: number;
  total: number;
  pct: number;
} {
  const done = steps.filter((s) => s.state === "done").length;
  return { done, total: steps.length, pct: Math.round((done / steps.length) * 100) };
}

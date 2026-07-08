import type { JobStatus } from "@/lib/types";

/**
 * Fun flow-guidance layer on top of the job's REAL status. Nothing here is a
 * separate step system — every step maps to an existing column on the job row
 * (`status`, `scheduled_date`, `warehouse_ready_at`). Given a job, it works out
 * which stage it's actually at and what the next move is.
 */

/** The minimum a job needs to expose for us to read its stage. */
export interface JobLike {
  id: string;
  customer_id: string;
  status: JobStatus;
  scheduled_date: string | null;
  warehouse_ready_at?: string | null;
}

interface StepDef {
  id: string;
  label: string;
  emoji: string;
  reached: (j: JobLike) => boolean;
  /** How to COMPLETE this step — shown as the "next" action button. */
  action: { label: string; href: (j: JobLike) => string } | null;
}

// Ordered by the real job lifecycle. `reached` predicates use ">= this stage"
// so a later status counts earlier steps as done (a completed job has been
// scheduled + started), which keeps the "current" pointer monotonic.
const STEPS: StepDef[] = [
  {
    id: "created",
    label: "Work order created",
    emoji: "📋",
    reached: () => true,
    action: null,
  },
  {
    id: "scheduled",
    label: "Install scheduled",
    emoji: "📅",
    reached: (j) =>
      j.status === "scheduled" ||
      j.status === "in_progress" ||
      j.status === "completed" ||
      !!j.scheduled_date,
    action: {
      label: "Schedule the install",
      href: (j) => `/customers/${j.customer_id}#jobs`,
    },
  },
  {
    id: "staged",
    label: "Materials staged",
    emoji: "📦",
    reached: (j) => !!j.warehouse_ready_at,
    action: { label: "Prep in the warehouse", href: () => `/warehouse` },
  },
  {
    id: "installing",
    label: "Install started",
    emoji: "🔨",
    reached: (j) => j.status === "in_progress" || j.status === "completed",
    action: { label: "Open the work order", href: (j) => `/jobs/${j.id}` },
  },
  {
    id: "completed",
    label: "Install completed",
    emoji: "🎉",
    reached: (j) => j.status === "completed",
    action: { label: "Mark it complete", href: (j) => `/jobs/${j.id}` },
  },
];

export interface JobProgress {
  jobId: string;
  cancelled: boolean;
  /** Highest-index step whose predicate is true (-1 only when cancelled). */
  currentIndex: number;
  totalSteps: number;
  /** The step just reached (for the celebratory "✓ … done" line). */
  current: { id: string; label: string; emoji: string } | null;
  /** The next move, already resolved to a concrete link. Null at the end. */
  next: {
    id: string;
    label: string;
    emoji: string;
    actionLabel: string;
    actionHref: string;
  } | null;
  isComplete: boolean;
}

/** Read a job's real stage → current step + the accurate next step. */
export function getJobProgress(job: JobLike): JobProgress {
  const totalSteps = STEPS.length;
  if (job.status === "cancelled") {
    return {
      jobId: job.id,
      cancelled: true,
      currentIndex: -1,
      totalSteps,
      current: null,
      next: null,
      isComplete: false,
    };
  }

  // Highest reached step = where the job actually is right now.
  let currentIndex = 0;
  for (let i = 0; i < STEPS.length; i++) {
    if (STEPS[i].reached(job)) currentIndex = i;
  }

  // Next = first not-yet-reached step AFTER the current one. Skipping an
  // earlier optional step (e.g. warehouse staging on a completed job) never
  // points backwards.
  let next: JobProgress["next"] = null;
  for (let i = currentIndex + 1; i < STEPS.length; i++) {
    const s = STEPS[i];
    if (!s.reached(job) && s.action) {
      next = {
        id: s.id,
        label: s.label,
        emoji: s.emoji,
        actionLabel: s.action.label,
        actionHref: s.action.href(job),
      };
      break;
    }
  }

  const cur = STEPS[currentIndex];
  return {
    jobId: job.id,
    cancelled: false,
    currentIndex,
    totalSteps,
    current: { id: cur.id, label: cur.label, emoji: cur.emoji },
    next,
    isComplete: next === null,
  };
}

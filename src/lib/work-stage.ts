/**
 * What is at a pipeline stage — and there is more than one kind of thing.
 *
 * The stage used to live only on `customers`, so an account held one position
 * however much work it had. For a contractor with three jobs running that means
 * two of them inherit the third's stage: reported as installing before anyone
 * measured them, in the wrong lane, with nothing chasing them. Every fix that
 * keeps the stage on the account is really a way of picking which job gets to be
 * the truth, and there's no right answer to that.
 *
 * The stage belongs to the smallest thing that can genuinely BE at a stage:
 *
 *   • a JOB, once one exists — each has its own stage, owner and SLA clock, so
 *     three jobs on one account chase independently;
 *   • the CUSTOMER, before any job exists — a lead being chased for a quote has
 *     no job to hang off, and that's 17 of 46 live accounts, the whole front
 *     half of the process.
 *
 * So "the pipeline" is a list of WORK UNITS, not a list of customers. This
 * module is the only place that decides which is which; nothing else should
 * read `workflow_stage_id` off a row directly.
 */

/** A row carrying the stage columns — customers and jobs both do. */
import { jobSiteLine } from "@/lib/job-label";

export interface StageBearing {
  workflow_stage_id?: string | null;
  workflow_owner_id?: string | null;
  next_action_due?: string | null;
}

export interface CustomerLike extends StageBearing {
  id: string;
  full_name?: string | null;
  assigned_to?: string | null;
}

export interface JobLike extends StageBearing {
  id: string;
  customer_id?: string | null;
  title?: string | null;
  status?: string | null;
  site_street?: string | null;
  site_city?: string | null;
  site_label?: string | null;
}

/** One thing that can sit in a lane, be chased, and be handed to someone. */
export interface WorkUnit {
  kind: "job" | "customer";
  /** The job id, or the customer id when there's no job yet. */
  id: string;
  customerId: string;
  customerName: string | null;
  /** The job's title; null for the pre-job phase. */
  title: string | null;
  /** WHERE the work is — the headline on any board that lists work. */
  site: string | null;
  stageId: string | null;
  ownerId: string | null;
  dueAt: string | null;
  /** True when this unit is standing in for the account itself. */
  preJob: boolean;
}

/** A job is live work if it hasn't been cancelled. Completed jobs still occupy a
 *  stage — "collect the balance" is real work — until the flow closes them out. */
export function isLiveJob(j: JobLike): boolean {
  return j.status !== "cancelled";
}

/**
 * The work unit for one job. Falls back to the account's stage while the job's
 * own is null, so rows written before the stage moved onto jobs keep reading
 * correctly instead of showing as unstaged.
 */
export function jobWorkUnit(job: JobLike, customer: CustomerLike): WorkUnit {
  return {
    kind: "job",
    id: job.id,
    customerId: customer.id,
    customerName: customer.full_name ?? null,
    title: job.title ?? null,
    site: jobSiteLine(job),
    stageId: job.workflow_stage_id ?? customer.workflow_stage_id ?? null,
    ownerId:
      job.workflow_owner_id ?? customer.workflow_owner_id ?? customer.assigned_to ?? null,
    dueAt: job.next_action_due ?? customer.next_action_due ?? null,
    preJob: false,
  };
}

/** The work unit for an account that has no job yet. */
export function customerWorkUnit(customer: CustomerLike): WorkUnit {
  return {
    kind: "customer",
    id: customer.id,
    customerId: customer.id,
    customerName: customer.full_name ?? null,
    title: null,
    // A lead with no job has no site yet — the account IS the unit of work.
    site: null,
    stageId: customer.workflow_stage_id ?? null,
    ownerId: customer.workflow_owner_id ?? customer.assigned_to ?? null,
    dueAt: customer.next_action_due ?? null,
    preJob: true,
  };
}

/**
 * Every work unit on an account: one per live job, or the account itself when
 * there are none. THE rule for turning customers + jobs into a pipeline, shared
 * by Client status, the customer file, the SLA sweep and the boards so they can
 * never disagree about how many things are in flight.
 */
export function workUnitsFor(customer: CustomerLike, jobs: JobLike[]): WorkUnit[] {
  const live = jobs.filter(isLiveJob);
  if (!live.length) return [customerWorkUnit(customer)];
  return live.map((j) => jobWorkUnit(j, customer));
}

/**
 * Which table an event should write its stage move to.
 *
 * Job-lifecycle events (install booked, install finished, material received,
 * warehouse staged) always belong to their job. Pre-job events (a call logged,
 * an estimate booked or sent) belong to the account until a job exists — after
 * which they belong to the job they're about, because that's the thing moving.
 */
export function stageTargetFor(
  jobId: string | null | undefined,
): { table: "jobs" | "customers"; id: string } | null {
  return jobId ? { table: "jobs", id: jobId } : null;
}

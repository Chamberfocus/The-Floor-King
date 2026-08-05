// The ONE shared model of "where is this job in the flow + is this step's action
// done." Built on the EXISTING pipeline (customers.workflow_stage_id) — this does
// not store status, it READS the real records (estimates, jobs, invoices,
// satisfaction, warehouse) to decide whether a step's action is complete, so the
// customer dashboard, job page, installer, and warehouse can all agree.

/** The guided-flow steps, in order. Mirrors the workflow-stage spine. */
export type FlowStep =
  | "contact"
  | "schedule_estimate"
  | "estimate_booked"
  | "build_quote"
  | "approve"
  | "collect_deposit"
  | "materials"
  | "schedule_install"
  | "waiting"
  | "await_install"
  | "install_in_progress"
  | "followup"
  | "collect_balance"
  | "complete"
  | "generic";

/** The real, record-backed facts each step's gate reads. All derivable from data
 *  the customer file already loads — no new status system. */
export interface FlowFacts {
  hasActivity: boolean; // a call/note logged
  estimateBooked: boolean; // an in-home/showroom estimate appointment exists
  hasEstimate: boolean; // at least one estimate built
  estimateSent: boolean; // a quote sent (or already approved)
  estimateApproved: boolean; // an approved estimate
  depositPaid: boolean; // a payment recorded on any invoice
  workOrderExists: boolean; // a job (work order) exists
  materialsStaged: boolean; // warehouse marked ready (surfaced, not required)
  installBooked: boolean; // the job has a scheduled date
  installComplete: boolean; // a job marked completed
  balancePaid: boolean; // no outstanding invoice balance
  satisfactionSigned: boolean; // customer sign-off captured (surfaced, not required)
}

// ---------------------------------------------------------------------------
// ONE step-resolution shared by the dashboard guided flow AND the job/installer/
// warehouse pages, so they all describe "where in the flow" the same way.
// (Moved out of guided-flow.tsx — pure, no React.)
// ---------------------------------------------------------------------------

export interface StageLike {
  id: string;
  name: string;
  position: number;
  auto_action?: string | null;
}

/** Off-ramp (dead deal) — outside the linear spine. */
export const isLostStage = (s: { name: string }) =>
  /lost|declin|dead|cancel/.test(s.name.toLowerCase());
/** On-hold park stage — reachable any time, not a numbered step. */
export const isParkStage = (s: { name: string }) =>
  /\bwaiting\b|\bon hold\b|\bhold\b|\bpark/.test(s.name.toLowerCase());
export const isOffSpine = (s: { name: string }) => isLostStage(s) || isParkStage(s);

/** Human title per step — shared so every surface labels it identically. */
export const STEP_TITLES: Record<FlowStep, string> = {
  contact: "Reach out & set the estimate",
  schedule_estimate: "Schedule the estimate",
  estimate_booked: "Measure & meet the customer",
  build_quote: "Build & send the quote",
  approve: "Get the quote approved",
  collect_deposit: "Collect the deposit",
  materials: "Order & prep materials",
  schedule_install: "Schedule the install",
  waiting: "Waiting on the customer",
  await_install: "Install scheduled",
  install_in_progress: "Install in progress",
  followup: "Sign-off & follow up",
  collect_balance: "Collect the balance",
  complete: "Job complete",
  generic: "Next step",
};

/** Map a workflow stage → its flow step. Anchors on the stable `auto_action`
 *  markers first, then name, then position — so a renamed stage still resolves. */
export function resolveFlowStep(
  stage: StageLike | null,
  stages: StageLike[],
): FlowStep {
  if (!stage) return "contact";
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const mainline = sorted.filter((s) => !isOffSpine(s));
  const auto = stage.auto_action ?? "none";
  if (auto === "schedule_estimate") return "schedule_estimate";
  if (auto === "build_quote") return "build_quote";
  if (auto === "collect_deposit") return "collect_deposit";
  if (auto === "schedule_install") return "schedule_install";

  const name = stage.name.toLowerCase();
  const first = mainline[0];
  const last = mainline[mainline.length - 1];
  if (first && stage.id === first.id) return "contact";
  if (last && stage.id === last.id) return "complete";
  // "Collect Balance" must resolve before "follow-up" so the dedicated balance
  // stage gets the balance gate (the Follow-up stage's NAME has no "balance").
  if (/balance/.test(name)) return "collect_balance";
  // Must beat the generic /install/ test below, which would file an in-flight
  // install as "still waiting to be installed".
  if (/in progress|in-progress/.test(name)) return "install_in_progress";
  if (/follow|installed|satisf/.test(name)) return "followup";
  if (/response|approv/.test(name)) return "approve";
  if (/wait|hold/.test(name)) return "waiting";
  if (/install/.test(name)) return "await_install";
  if (/material|order|warehouse|stag/.test(name)) return "materials";
  if (/estimate|measur/.test(name)) return "estimate_booked";

  const posOf = (aa: string) =>
    sorted.find((s) => s.auto_action === aa)?.position ?? null;
  const pB = posOf("build_quote");
  const pD = posOf("collect_deposit");
  const pI = posOf("schedule_install");
  if (pB != null && pD != null && stage.position > pB && stage.position < pD) return "approve";
  if (pD != null && pI != null && stage.position > pD && stage.position < pI) return "materials";
  return "generic";
}

/** The next stage on the spine (skips off-ramp + park). */
export function nextMainlineStage<T extends StageLike>(
  stage: StageLike | null,
  stages: T[],
): T | null {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  if (!stage) return sorted.find((s) => !isOffSpine(s)) ?? null;
  return sorted.find((s) => s.position > stage.position && !isOffSpine(s)) ?? null;
}

/** "Stage X of N" position on the linear spine (1-based), or 0 if off-spine. */
export function spinePosition(
  stage: StageLike | null,
  stages: StageLike[],
): { index: number; total: number } {
  const mainline = [...stages]
    .sort((a, b) => a.position - b.position)
    .filter((s) => !isOffSpine(s));
  const index = stage ? mainline.findIndex((s) => s.id === stage.id) : -1;
  return { index, total: mainline.length };
}

export interface StepGate {
  /** Is this step's action complete — i.e. is it OK to advance? */
  done: boolean;
  /** When blocked, the clear reason + exactly what's needed. Null when done. */
  reason: string | null;
}

const OK: StepGate = { done: true, reason: null };
const block = (reason: string): StepGate => ({ done: false, reason });

/**
 * STRICT gate: can the job advance OFF `step`? Returns done=true, or a clear
 * reason pointing at the action that's still needed. Off-spine/terminal steps
 * (waiting, complete, generic) are never gated here.
 */
export function stepGate(step: FlowStep, f: FlowFacts): StepGate {
  switch (step) {
    case "contact":
      return f.hasActivity || f.estimateBooked
        ? OK
        : block("Log a call or note in Activity (or book the estimate) before advancing.");
    case "schedule_estimate":
      return f.estimateBooked ? OK : block("Book the in-home estimate or showroom visit to advance.");
    case "estimate_booked":
      // "Measure & meet" — the estimate is built at the NEXT stage, and there's
      // no digital record of a measurement, so this soft step advances freely.
      return OK;
    case "build_quote":
      return f.estimateSent ? OK : block("Send the quote to the customer to advance.");
    case "approve":
      return f.estimateApproved ? OK : block("Mark the estimate approved (customer said yes) to advance.");
    case "collect_deposit":
      return f.depositPaid ? OK : block("Record the deposit payment to advance.");
    case "materials":
      return f.workOrderExists ? OK : block("Create the work order to advance.");
    case "schedule_install":
      return f.installBooked ? OK : block("Book the install date in the scheduler to advance.");
    case "await_install":
      return f.installComplete ? OK : block("Mark the install complete on the work order to advance.");
    case "install_in_progress":
      // The crew is on site. Same gate as awaiting it — the work order is what
      // says the job is done, not a stage click.
      return f.installComplete ? OK : block("Mark the install complete on the work order to advance.");
    case "followup":
      // Follow-up is the sign-off / touch-base step; the balance is collected at
      // its own gated stage next, so this advances freely.
      return OK;
    case "collect_balance":
      return f.balancePaid ? OK : block("Collect the remaining balance to advance.");
    default:
      return OK; // waiting (park), complete (terminal), generic
  }
}

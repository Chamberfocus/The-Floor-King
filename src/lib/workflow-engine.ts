// Intelligent workflow automation: move a customer to whichever editable stage
// is configured (by its auto_action) to handle a given event — e.g. an
// approved estimate jumps them to the "collect deposit" stage. SERVER ONLY.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StageAutoAction, LeadStage } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

/**
 * Coupling switch for the pipeline. When false (the default), real job events —
 * estimate approved, deposit paid, install booked, install completed, warehouse
 * submitted — auto-advance the customer's workflow stage FORWARD to match, so
 * the dashboard spine always reflects where the job actually is. It is strictly
 * forward-only (never drags a customer back), and the manual "ready for next
 * stage" button remains available as an override. Flip to true only to freeze
 * the pipeline into fully-manual mode.
 */
const AUTO_ADVANCE_DISABLED = false;

/**
 * Workflow automation runs with the service role so it works no matter who
 * triggered the event (staff or a customer in the portal) — it's trusted
 * server logic, not user input. Returns null if the key isn't configured.
 */
function engineDb(): DB | null {
  try {
    return createAdminClient() as unknown as DB;
  } catch {
    return null;
  }
}

interface StageRow {
  id: string;
  name: string;
  position: number;
  sla_hours: number | null;
  default_owner: string | null;
}

interface CustRow {
  workflow_stage_id: string | null;
  workflow_owner_id: string | null;
}

interface AnchorRow {
  position: number;
  auto_action: string | null;
  name: string | null;
}

/**
 * Map an editable workflow stage to the coarse `lead_stage` so the legacy
 * pipeline board, leads list, and dashboard counts stay in lock-step with the
 * one source of truth. We anchor off the stable `auto_action` markers (not
 * stage names, which the user can rename) plus position ordering.
 */
export function deriveLeadStage(
  target: { name: string | null; position: number },
  all: AnchorRow[],
): LeadStage {
  const name = (target.name ?? "").toLowerCase();
  if (/lost|declin|dead|cancel/.test(name)) return "lost";

  const posOf = (aa: string): number | null => {
    const s = all.find((x) => x.auto_action === aa);
    return s ? s.position : null;
  };
  const deposit = posOf("collect_deposit");
  const quote = posOf("build_quote");
  const estSched = posOf("schedule_estimate");

  if (deposit != null && target.position >= deposit) return "won";
  if (quote != null && target.position >= quote) return "quoted";
  if (estSched != null && target.position >= estSched) return "estimate_scheduled";

  const positions = all.map((s) => s.position);
  const minPos = positions.length ? Math.min(...positions) : target.position;
  return target.position <= minPos ? "new" : "contacted";
}

/** Apply a stage move: keep the owner (else stage default), set SLA due, log it. */
/**
 * Which row a stage move writes to.
 *
 * A JOB carries its own stage once it exists, so three jobs on one account move
 * independently. The CUSTOMER carries it only for the phase before any job — a
 * lead being chased for a quote, which is 17 of 46 live accounts. See
 * src/lib/work-stage.ts for the rule; this is where it's written.
 */
export interface StageTarget {
  table: "jobs" | "customers";
  /** The job id, or the customer id for pre-job work. */
  id: string;
  /** Always the account, because handoffs and activities hang off it. */
  customerId: string;
}

/** Job when we're given one, else the account — see src/lib/work-stage.ts. */
function stageTarget(customerId: string, jobId?: string | null): StageTarget {
  return jobId
    ? { table: "jobs", id: jobId, customerId }
    : { table: "customers", id: customerId, customerId };
}

async function loadTarget(
  supabase: DB,
  target: StageTarget,
): Promise<CustRow | null> {
  const { data } = await supabase
    .from(target.table)
    .select("workflow_stage_id, workflow_owner_id")
    .eq("id", target.id)
    .maybeSingle();
  return (data as CustRow) ?? null;
}

async function applyMove(
  supabase: DB,
  target: StageTarget,
  cust: CustRow,
  stage: StageRow,
): Promise<void> {
  const owner = cust.workflow_owner_id ?? stage.default_owner ?? null;
  const due =
    stage.sla_hours && stage.sla_hours > 0
      ? new Date(Date.now() + stage.sla_hours * 3600 * 1000).toISOString()
      : null;

  // Keep the legacy lead_stage in lock-step with the workflow stage.
  const { data: anchors } = await supabase
    .from("workflow_stages")
    .select("position, auto_action, name");
  const leadStage = deriveLeadStage(stage, (anchors as AnchorRow[]) ?? []);

  const patch = {
    workflow_stage_id: stage.id,
    workflow_owner_id: owner,
    next_action_due: due,
  };

  /**
   * Write to the job, and fall back to the account if the job can't hold a
   * stage yet.
   *
   * `jobs.workflow_stage_id` arrives in migration 0150, which is run by hand in
   * the Supabase editor. Between this code deploying and that migration running,
   * a job-targeted write would fail against a column that doesn't exist — and
   * every auto-advance the shop relies on today would quietly stop. So a failed
   * job write degrades to the old behaviour instead of doing nothing, and starts
   * working properly the moment the migration lands. No deploy ordering to get
   * right, and no window where the pipeline silently stalls.
   */
  let wroteTo: "jobs" | "customers" = target.table;
  if (target.table === "jobs") {
    const { error } = await supabase.from("jobs").update(patch).eq("id", target.id);
    if (error) wroteTo = "customers";
  }
  if (wroteTo === "customers") {
    await supabase
      .from("customers")
      // `stage` is the coarse lead_stage enum and only exists on customers.
      .update({ ...patch, stage: leadStage })
      .eq("id", target.customerId);
  }

  /**
   * An account whose work has ALL moved past the lead phase shouldn't still
   * read as a lead on the customer list. The coarse enum stays a roll-up of the
   * account, so a job move refreshes it from the job that moved.
   */
  if (wroteTo === "jobs") {
    await supabase
      .from("customers")
      .update({ stage: leadStage })
      .eq("id", target.customerId);
  }

  await supabase.from("handoffs").insert({
    customer_id: target.customerId,
    from_stage_id: cust.workflow_stage_id ?? null,
    to_stage_id: stage.id,
    from_user: cust.workflow_owner_id ?? null,
    to_user: owner,
    note: wroteTo === "jobs" ? "Auto-advanced (job)" : "Auto-advanced",
  });

  await supabase.from("activities").insert({
    customer_id: target.customerId,
    type: "stage_change",
    body: `Auto-advanced to "${stage.name}"`,
  });

  // Landing on a terminal stage finishes the work too.
  await settleJobsForStage(
    supabase,
    target.customerId,
    stage,
    ((anchors as AnchorRow[]) ?? []).map((a) => ({
      name: a.name ?? "",
      position: a.position,
    })),
  );
}

/**
 * Reaching the end of the pipeline must finish the WORK, not just the customer.
 *
 * Moving someone to "Closed" or "Collect Balance" never touched their jobs, so
 * a job stayed `scheduled` or `in_progress` forever — still on the job board,
 * still on the install schedule, still in the warehouse queue, still on the
 * installer's list. Twelve customers were sitting like that.
 *
 * The two ends of the pipeline mean opposite things:
 *   past the install  -> the work happened  -> complete the job
 *   lost / declined    -> it never will      -> cancel it and free the material
 *
 * Position alone can't tell them apart: "Lost / Declined" (120) sits BETWEEN
 * "Collect Balance" (115) and "Closed" (130), so this matches on name.
 *
 * Never touches a job that is already completed or cancelled, and never
 * re-opens one — this only ever moves work forward to a finished state.
 */
export async function settleJobsForStage(
  supabase: DB,
  customerId: string,
  stage: { name: string; position: number },
  allStages: { name: string; position: number }[],
): Promise<void> {
  const lost = /lost|declin|dead/i.test(stage.name);
  // Where "the install has happened" begins, read from the stage list rather
  // than hard-coded, so renaming or renumbering stages can't silently break it.
  const installedPos =
    allStages.find((s) => /installed|follow/i.test(s.name))?.position ?? Infinity;
  const finished = !lost && stage.position >= installedPos;
  if (!lost && !finished) return;

  const { data: live } = await supabase
    .from("jobs")
    .select("id, status, scheduled_date")
    .eq("customer_id", customerId)
    .not("status", "in", "(completed,cancelled)");
  if (!live?.length) return;

  for (const j of live) {
    if (lost) {
      await supabase.from("jobs").update({ status: "cancelled" }).eq("id", j.id);
      continue;
    }
    // Date it when the install was actually booked, not the moment somebody
    // finally moved the stage — otherwise a July job lands in August's profit.
    const today = new Date().toISOString().slice(0, 10);
    const when =
      j.scheduled_date && (j.scheduled_date as string) <= today
        ? `${j.scheduled_date}T12:00:00.000Z`
        : new Date().toISOString();
    await supabase
      .from("jobs")
      .update({ status: "completed", completed_at: when })
      .eq("id", j.id);
  }

  await supabase.from("activities").insert({
    customer_id: customerId,
    type: "system",
    body: `${live.length} job${live.length === 1 ? "" : "s"} ${
      lost ? "cancelled" : "marked complete"
    } automatically — the customer reached "${stage.name}".`,
  });
}

/**
 * Advance a customer to the lowest-position stage whose `auto_action` matches.
 * No-op if no stage uses that auto_action, or the customer is already there.
 */
export async function moveToAutoActionStage(
  customerId: string,
  autoAction: StageAutoAction,
  jobId?: string | null,
): Promise<void> {
  // Auto-advance IS enabled (AUTO_ADVANCE_DISABLED = false): booking an install,
  // approving/sending an estimate, recording a deposit, and completing a job all
  // move the customer's stage forward automatically (forward-only). Flip
  // AUTO_ADVANCE_DISABLED to true to revert to a manual-only pipeline.
  if (AUTO_ADVANCE_DISABLED) return;
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner, auto_action")
    .order("position", { ascending: true });
  const list = (stages ?? []) as (StageRow & { auto_action: string })[];
  const target = list.find((s) => s.auto_action === autoAction);
  if (!target) return;
  const unit: StageTarget = stageTarget(customerId, jobId);
  const cust = await loadTarget(supabase, unit);
  if (!cust || cust.workflow_stage_id === target.id) return;
  // Forward-only: never drag a customer back to an earlier stage.
  const current = cust.workflow_stage_id
    ? list.find((s) => s.id === cust.workflow_stage_id)
    : null;
  if (current && current.position >= target.position) return;
  await applyMove(supabase, unit, cust, target);
}

/**
 * An event happened (estimate booked, quote sent, deposit paid, install booked)
 * that means the job is past the stage with `fromAutoAction`. Move the customer
 * FORWARD to the stage right after it — from wherever they are now (including
 * unstaged), but never backward. So booking an estimate for a brand-new lead
 * jumps them straight to "Estimate Scheduled".
 */
export async function advanceFromAutoAction(
  customerId: string,
  fromAutoAction: StageAutoAction,
  jobId?: string | null,
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return; // manual-only pipeline — see note above
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const unit: StageTarget = stageTarget(customerId, jobId);
  const cust = await loadTarget(supabase, unit);
  if (!cust) return;

  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner, auto_action")
    .order("position", { ascending: true });
  const list = (stages ?? []) as (StageRow & { auto_action: string })[];
  const from = list.find((s) => s.auto_action === fromAutoAction);
  if (!from) return;
  const next = list.find((s) => s.position > from.position);
  if (!next) return;

  // Where are they now? Unstaged = before everything.
  const current = cust.workflow_stage_id
    ? list.find((s) => s.id === cust.workflow_stage_id)
    : null;
  const currentPos = current ? current.position : -Infinity;
  if (currentPos >= next.position) return; // already there or further along
  await applyMove(supabase, unit, cust, next);
}

/**
 * Advance a customer FORWARD to the first stage whose name matches `re`
 * (forward-only — never drags backward). This wires job-lifecycle events to the
 * matching pipeline stage for the back half of the pipeline ("Install Scheduled",
 * "Installed – Follow-up"…), which carry no auto_action marker. Best-effort:
 * no-op in manual mode or if no stage name matches (so a renamed stage set just
 * falls back to no auto-advance rather than breaking).
 */
export async function advanceToNamedStage(
  customerId: string,
  re: RegExp,
  jobId?: string | null,
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return;
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const unit: StageTarget = stageTarget(customerId, jobId);
  const cust = await loadTarget(supabase, unit);
  if (!cust) return;
  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner")
    .order("position", { ascending: true });
  const list = (stages ?? []) as StageRow[];
  const target = list.find((s) => re.test((s.name ?? "").toLowerCase()));
  if (!target) return;
  const current = cust.workflow_stage_id
    ? list.find((s) => s.id === cust.workflow_stage_id)
    : null;
  const currentPos = current ? current.position : -Infinity;
  if (currentPos >= target.position) return; // already there or further along
  await applyMove(supabase, unit, cust, target);
}

/**
 * Advance off the first stage (New Lead) to the next one — used when the first
 * activity is logged. No-op if the customer has already moved past stage one.
 */
export async function advanceFromFirstStage(
  customerId: string,
  jobId?: string | null,
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return; // manual-only pipeline — see note above
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const unit: StageTarget = stageTarget(customerId, jobId);
  const cust = await loadTarget(supabase, unit);
  if (!cust) return;

  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner")
    .order("position", { ascending: true });
  const list = (stages ?? []) as StageRow[];
  if (list.length < 2) return;
  const first = list[0];
  // Only nudge a lead that is explicitly sitting on stage one. An unstaged
  // customer (no workflow stage yet) is left alone — never auto-jumped.
  if (cust.workflow_stage_id !== first.id) return;
  await applyMove(supabase, unit, cust, list[1]);
}

/**
 * A repeat customer has started a NEW piece of work — put the account back at
 * the beginning of the flow for it.
 *
 * The workflow stage lives on the CUSTOMER, not the job, so an account carries
 * exactly one position in the pipeline however much work it has. For a repeat
 * customer that means a brand-new job inherits wherever the last one finished:
 * JDP Home Improvements booked a second and third job while the account sat on
 * "Install In Progress", so the new rooms were reported as being installed
 * before anyone had measured them — wrong lane on Client status, no next-action
 * date, and nothing chasing the work.
 *
 * This is the ONE deliberate exception to the engine's forward-only rule. Every
 * other mover refuses to drag a customer back, because a real event never
 * un-happens. Starting new work is different: it genuinely restarts the process,
 * and the account's stage should describe the job that now needs doing rather
 * than the one that's finished.
 *
 * Where it lands depends on what the job already has, so a job created from an
 * approved quote doesn't get sent back to "book the measure":
 *   • nothing yet          → the stage that schedules the estimate
 *   • an unapproved quote  → the stage that builds/sends the quote
 *   • an approved quote    → the deposit stage
 *   • a date already booked → left alone; it's further along than any of these
 *
 * NOT a silent no-op when the customer still has other live work: the account
 * can only hold one position, so the older job's place in the pipeline is given
 * up. The caller decides whether that's acceptable and says so in the UI.
 */
export async function restartFlowForNewWork(
  customerId: string,
  job: { hasEstimate: boolean; estimateApproved: boolean; booked: boolean },
  jobId?: string | null,
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return;
  if (!customerId || job.booked) return;
  const supabase = engineDb();
  if (!supabase) return;

  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner, auto_action")
    .order("position", { ascending: true });
  const list = (stages ?? []) as (StageRow & { auto_action: string | null })[];
  if (!list.length) return;

  const byAction = (a: string) => list.find((s) => s.auto_action === a) ?? null;
  // Off-spine stages (Lost / on-hold) are never a starting point for live work.
  const mainline = list.filter(
    (s) => !/lost|declin|dead|cancel|waiting|on hold|hold|park/i.test(s.name ?? ""),
  );

  const target = job.estimateApproved
    ? (byAction("collect_deposit") ?? byAction("build_quote"))
    : job.hasEstimate
      ? (byAction("build_quote") ?? byAction("schedule_estimate"))
      : (byAction("schedule_estimate") ?? mainline[0] ?? null);
  if (!target) return;

  const unit: StageTarget = stageTarget(customerId, jobId);
  const cust = await loadTarget(supabase, unit);
  if (!cust || cust.workflow_stage_id === target.id) return;
  await applyMove(supabase, unit, cust, target);
}

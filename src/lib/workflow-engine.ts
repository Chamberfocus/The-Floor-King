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
async function applyMove(
  supabase: DB,
  customerId: string,
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

  await supabase
    .from("customers")
    .update({
      workflow_stage_id: stage.id,
      workflow_owner_id: owner,
      next_action_due: due,
      stage: leadStage,
    })
    .eq("id", customerId);

  await supabase.from("handoffs").insert({
    customer_id: customerId,
    from_stage_id: cust.workflow_stage_id ?? null,
    to_stage_id: stage.id,
    from_user: cust.workflow_owner_id ?? null,
    to_user: owner,
    note: "Auto-advanced",
  });

  await supabase.from("activities").insert({
    customer_id: customerId,
    type: "stage_change",
    body: `Auto-advanced to "${stage.name}"`,
  });
}

async function loadCustomer(
  supabase: DB,
  customerId: string,
): Promise<CustRow | null> {
  const { data } = await supabase
    .from("customers")
    .select("workflow_stage_id, workflow_owner_id")
    .eq("id", customerId)
    .maybeSingle();
  return (data as CustRow) ?? null;
}

/**
 * Advance a customer to the lowest-position stage whose `auto_action` matches.
 * No-op if no stage uses that auto_action, or the customer is already there.
 */
export async function moveToAutoActionStage(
  customerId: string,
  autoAction: StageAutoAction,
): Promise<void> {
  // MANUAL-ONLY PIPELINE: stage advancement happens exclusively when a user
  // presses "ready for next stage" on the customer dashboard (advanceWorkflow).
  // Auto-advance is disabled everywhere — including the customer portal — so a
  // job never moves stage on its own. Callers stay in place (harmless no-op);
  // re-enable by removing this guard. deriveLeadStage below is still used by the
  // manual advance to keep the legacy lead_stage in lock-step.
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
  const cust = await loadCustomer(supabase, customerId);
  if (!cust || cust.workflow_stage_id === target.id) return;
  // Forward-only: never drag a customer back to an earlier stage.
  const current = cust.workflow_stage_id
    ? list.find((s) => s.id === cust.workflow_stage_id)
    : null;
  if (current && current.position >= target.position) return;
  await applyMove(supabase, customerId, cust, target);
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
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return; // manual-only pipeline — see note above
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const cust = await loadCustomer(supabase, customerId);
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
  await applyMove(supabase, customerId, cust, next);
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
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return;
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const cust = await loadCustomer(supabase, customerId);
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
  await applyMove(supabase, customerId, cust, target);
}

/**
 * Advance off the first stage (New Lead) to the next one — used when the first
 * activity is logged. No-op if the customer has already moved past stage one.
 */
export async function advanceFromFirstStage(
  customerId: string,
): Promise<void> {
  if (AUTO_ADVANCE_DISABLED) return; // manual-only pipeline — see note above
  if (!customerId) return;
  const supabase = engineDb();
  if (!supabase) return;
  const cust = await loadCustomer(supabase, customerId);
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
  await applyMove(supabase, customerId, cust, list[1]);
}

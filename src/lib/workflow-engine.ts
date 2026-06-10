// Intelligent workflow automation: move a customer to whichever editable stage
// is configured (by its auto_action) to handle a given event — e.g. an
// approved estimate jumps them to the "collect deposit" stage. SERVER ONLY.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StageAutoAction } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

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

  await supabase
    .from("customers")
    .update({
      workflow_stage_id: stage.id,
      workflow_owner_id: owner,
      next_action_due: due,
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
  supabase: DB,
  customerId: string,
  autoAction: StageAutoAction,
): Promise<void> {
  if (!customerId) return;
  const { data: stage } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner")
    .eq("auto_action", autoAction)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return;
  const cust = await loadCustomer(supabase, customerId);
  if (!cust || cust.workflow_stage_id === stage.id) return;
  await applyMove(supabase, customerId, cust, stage as StageRow);
}

/**
 * Move to the stage right after the one with `fromAutoAction` — but ONLY if the
 * customer is currently sitting on that stage. Used when an event happens whose
 * "next" stage has no tool of its own (e.g. deposit recorded → order materials).
 */
export async function advanceFromAutoAction(
  supabase: DB,
  customerId: string,
  fromAutoAction: StageAutoAction,
): Promise<void> {
  if (!customerId) return;
  const cust = await loadCustomer(supabase, customerId);
  if (!cust?.workflow_stage_id) return;

  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner, auto_action")
    .order("position", { ascending: true });
  const list = (stages ?? []) as (StageRow & { auto_action: string })[];
  const from = list.find((s) => s.auto_action === fromAutoAction);
  if (!from || cust.workflow_stage_id !== from.id) return; // not on that stage
  const next = list.find((s) => s.position > from.position);
  if (!next) return;
  await applyMove(supabase, customerId, cust, next);
}

/**
 * Advance off the first stage (New Lead) to the next one — used when the first
 * activity is logged. No-op if the customer has already moved past stage one.
 */
export async function advanceFromFirstStage(
  supabase: DB,
  customerId: string,
): Promise<void> {
  if (!customerId) return;
  const cust = await loadCustomer(supabase, customerId);
  if (!cust) return;

  const { data: stages } = await supabase
    .from("workflow_stages")
    .select("id, name, position, sla_hours, default_owner")
    .order("position", { ascending: true });
  const list = (stages ?? []) as StageRow[];
  if (list.length < 2) return;
  const first = list[0];
  // Only nudge if they're still on the very first stage (or unstaged).
  if (cust.workflow_stage_id && cust.workflow_stage_id !== first.id) return;
  await applyMove(supabase, customerId, cust, list[1]);
}

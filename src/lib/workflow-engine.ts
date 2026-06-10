// Intelligent workflow automation: move a customer to whichever editable stage
// is configured (by its auto_action) to handle a given event — e.g. an
// approved estimate jumps them to the "collect deposit" stage. SERVER ONLY.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StageAutoAction } from "@/lib/types";

/**
 * Advance a customer to the lowest-position stage whose `auto_action` matches.
 * Keeps the current owner if there is one (else uses the stage's default owner),
 * sets the next-action due date from the stage SLA, and logs a handoff.
 * No-op if no stage uses that auto_action, or the customer is already there.
 */
export async function moveToAutoActionStage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  customerId: string,
  autoAction: StageAutoAction,
): Promise<void> {
  if (!customerId) return;

  const { data: stage } = await supabase
    .from("workflow_stages")
    .select("id, name, sla_hours, default_owner")
    .eq("auto_action", autoAction)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return;

  const { data: cust } = await supabase
    .from("customers")
    .select("workflow_stage_id, workflow_owner_id")
    .eq("id", customerId)
    .maybeSingle();
  if (!cust || cust.workflow_stage_id === stage.id) return; // already there

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

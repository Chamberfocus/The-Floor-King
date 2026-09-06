/**
 * Load / create estimate approval snapshots (Step 6).
 * F7/0178: approval writes go through record_estimate_approval_safe —
 * live-built commercial snapshot, portal via my_customer_id(), no service_role
 * portal path, staff actor = auth.uid() (spoof rejected).
 */
import { createClient } from "@/lib/supabase/server";
import { buildApprovalIdempotencyKey } from "@/lib/estimate-approval-idempotency";
import {
  type ApprovalSnapshotPayload,
  type ApprovalSource,
  type EstimateApprovalSnapshot,
} from "@/lib/estimate-approval";

function mapSnapshot(row: Record<string, unknown>): EstimateApprovalSnapshot {
  return {
    id: row.id as string,
    estimate_id: row.estimate_id as string,
    version: Number(row.version),
    accepted_option_id: (row.accepted_option_id as string) ?? null,
    approved_at: row.approved_at as string,
    approval_source: row.approval_source as ApprovalSource,
    approved_by_user_id: (row.approved_by_user_id as string) ?? null,
    approved_by_customer_id: (row.approved_by_customer_id as string) ?? null,
    payload: row.payload as ApprovalSnapshotPayload,
    created_at: row.created_at as string,
  };
}

export async function listApprovalSnapshots(
  estimateId: string,
): Promise<EstimateApprovalSnapshot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimate_approval_snapshots")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("version", { ascending: true });
  if (error) {
    return [];
  }
  return (data ?? []).map((r) => mapSnapshot(r as Record<string, unknown>));
}

export async function getCurrentApprovalSnapshot(
  estimateId: string,
): Promise<EstimateApprovalSnapshot | null> {
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("current_approval_snapshot_id")
    .eq("id", estimateId)
    .maybeSingle();
  const sid = est?.current_approval_snapshot_id as string | null | undefined;
  if (sid) {
    const { data } = await supabase
      .from("estimate_approval_snapshots")
      .select("*")
      .eq("id", sid)
      .maybeSingle();
    if (data) return mapSnapshot(data as Record<string, unknown>);
  }
  const { data: latest } = await supabase
    .from("estimate_approval_snapshots")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest ? mapSnapshot(latest as Record<string, unknown>) : null;
}

export type RecordApprovalArgs = {
  estimateId: string;
  acceptedOptionId: string | null;
  source: ApprovalSource;
  approvedByUserId?: string | null;
  approvedByCustomerId?: string | null;
  /**
   * @deprecated Portal must use the caller's JWT (createClient). Admin/service_role
   * portal approval is rejected by 0178 (APPROVAL_PORTAL_SERVICE_ROLE).
   */
  admin?: boolean;
  idempotencyKey?: string | null;
};

/**
 * Atomic approval via record_estimate_approval_safe (0178).
 * Snapshot is built from LIVE commercial state inside the DB — callers do not
 * supply a payload. Portal identity = auth.uid() → my_customer_id().
 */
export async function recordEstimateApproval(
  args: RecordApprovalArgs,
): Promise<{ error: string | null; snapshotId: string | null }> {
  if (args.admin && args.source === "portal") {
    return {
      error:
        "Portal approval must use the customer session (service_role elevation is not allowed).",
      snapshotId: null,
    };
  }

  // Always the caller's JWT — portal ownership is DB-enforced via my_customer_id().
  const db = await createClient();

  let idempotencyKey = args.idempotencyKey ?? null;
  if (!idempotencyKey) {
    const { data: est } = await db
      .from("estimates")
      .select("current_approval_snapshot_id")
      .eq("id", args.estimateId)
      .maybeSingle();
    idempotencyKey = buildApprovalIdempotencyKey({
      estimateId: args.estimateId,
      source: args.source,
      optionId: args.acceptedOptionId,
      snapshotId: (est?.current_approval_snapshot_id as string | null) ?? null,
    });
  }

  const { data: rpcData, error: rpcErr } = await db.rpc(
    "record_estimate_approval_safe",
    {
      p_estimate_id: args.estimateId,
      p_accepted_option_id: args.acceptedOptionId,
      p_approval_source: args.source,
      p_approved_by_user_id: args.approvedByUserId ?? null,
      p_approved_by_customer_id: args.approvedByCustomerId ?? null,
      p_idempotency_key: idempotencyKey,
    },
  );

  if (!rpcErr && rpcData && typeof rpcData === "object") {
    const res = rpcData as {
      ok?: boolean;
      snapshot_id?: string;
      error?: string;
      code?: string;
    };
    if (res.ok && res.snapshot_id) {
      return { error: null, snapshotId: res.snapshot_id };
    }
    return {
      error:
        res.error ||
        "Approval could not be completed — the approval record could not be saved.",
      snapshotId: null,
    };
  }

  const missingRpc =
    rpcErr &&
    (/function.*record_estimate_approval_safe/i.test(rpcErr.message) ||
      rpcErr.message.includes("does not exist") ||
      rpcErr.code === "PGRST202");

  if (missingRpc) {
    return {
      error:
        "Approval could not be completed — apply migration 0178 (record_estimate_approval_safe), then try again.",
      snapshotId: null,
    };
  }

  return {
    error:
      "Approval could not be completed. Try again or contact the office.",
    snapshotId: null,
  };
}

/** Convert a DB line row to JSON for apply_estimate_option_lines. */
export function lineRowToRpcJson(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "option_id") continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

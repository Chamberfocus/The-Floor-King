/**
 * Thin helpers for F6-P4 inventory RPCs.
 * Prefer these over direct stock_movements DML.
 */
export type InvRpcResult = {
  ok?: boolean;
  error?: string;
  code?: string;
  movement_id?: string;
  product_id?: string;
  job_id?: string;
  roll_id?: string;
  qty?: number;
  duplicate?: boolean;
  skipped?: boolean;
  reason?: string;
  delta?: number;
  on_hand?: number;
  ap_credit?: string;
};

export function parseInvRpc(data: unknown, error: { message?: string } | null): InvRpcResult {
  if (error) return { ok: false, error: error.message || String(error) };
  if (data && typeof data === "object") return data as InvRpcResult;
  return { ok: false, error: "Unexpected inventory RPC response." };
}

export function invRpcOk(r: InvRpcResult): boolean {
  return r.ok === true;
}

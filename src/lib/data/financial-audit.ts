/**
 * F6-P2A read model for financial_audit_log (admin/office SELECT via RLS).
 */
import { createClient } from "@/lib/supabase/server";
import type {
  FinancialAuditEntry,
  FinancialAuditFilters,
} from "@/lib/accounting/audit-log";

type AuditRow = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  economic_date: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  idempotency_key: string | null;
};

function mapRow(row: AuditRow): FinancialAuditEntry {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    economicDate: row.economic_date,
    reason: row.reason,
    payload: row.payload ?? {},
    idempotencyKey: row.idempotency_key,
  };
}

export async function listFinancialAuditEvents(
  filters: FinancialAuditFilters = {},
): Promise<FinancialAuditEntry[]> {
  const supabase = await createClient();
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  let q = supabase
    .from("financial_audit_log")
    .select(
      "id, occurred_at, actor_id, action, entity_type, entity_id, economic_date, reason, payload, idempotency_key",
    )
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (filters.startDate) {
    q = q.gte("occurred_at", `${filters.startDate}T00:00:00.000Z`);
  }
  if (filters.endDate) {
    q = q.lte("occurred_at", `${filters.endDate}T23:59:59.999Z`);
  }
  if (filters.action) {
    q = q.eq("action", filters.action);
  }
  if (filters.entityType) {
    q = q.eq("entity_type", filters.entityType);
  }
  if (filters.entityId) {
    q = q.eq("entity_id", filters.entityId);
  }
  if (filters.actorId) {
    q = q.eq("actor_id", filters.actorId);
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`financial_audit_log query failed: ${error.message}`);
  }
  return (data ?? []).map((row) => mapRow(row as AuditRow));
}

export async function getFinancialAuditEvent(
  id: string,
): Promise<FinancialAuditEntry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("financial_audit_log")
    .select(
      "id, occurred_at, actor_id, action, entity_type, entity_id, economic_date, reason, payload, idempotency_key",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw new Error(`financial_audit_log lookup failed: ${error.message}`);
  }
  return data ? mapRow(data as AuditRow) : null;
}

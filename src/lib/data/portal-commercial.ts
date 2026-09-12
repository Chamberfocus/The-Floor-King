/**
 * Portal commercial reads — customer-safe views (0181), never base-table *.
 * Staff continue to use src/lib/data/estimates.ts / jobs.ts on the base tables.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/paginate";
import { COMPANY_NAME } from "@/lib/nav";
import {
  sanitizeApprovalPayloadForCustomer,
  type ApprovalSnapshotPayload,
  type EstimateApprovalSnapshot,
} from "@/lib/estimate-approval";
import { buildCustomerScope, type CustomerScope } from "@/lib/customer-scope";
import type {
  Estimate,
  EstimateLineItem,
  EstimateOption,
  Job,
  OrgSettings,
} from "@/lib/types";

const PORTAL_ORG_DEFAULTS: OrgSettings = {
  id: "default",
  company_name: COMPANY_NAME,
  logo_url: null,
  primary_color: null,
  phone: null,
  email: null,
  address: null,
  website: null,
  financing_url: null,
  google_review_url: null,
  card_processing_url: null,
  fuel_surcharge_pct: 0,
  freight_markup_pct: 0,
  quote_valid_days: 30,
  freight_disclaimer: null,
  updated_at: "",
};

function asLine(row: Record<string, unknown>): EstimateLineItem {
  return {
    ...(row as unknown as EstimateLineItem),
    product_id: null,
    measurements: null,
    material_cost: null,
    labor_cost: null,
    margin_pct: null,
    from_stock: false,
  };
}

function asEstimate(row: Record<string, unknown>): Estimate {
  return {
    ...(row as unknown as Estimate),
    target_margin: null,
    notes: null,
    created_by: null,
    thankyou_sent_at: null,
    approved_by_user_id: null,
  };
}

async function attachPortalOptions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  estimates: Estimate[],
): Promise<Estimate[]> {
  if (!estimates.length) return estimates;
  const estimateIds = estimates.map((e) => e.id);
  const { data: optionRows } = await supabase
    .from("estimate_options_customer")
    .select("id, estimate_id, name, position, created_at")
    .in("estimate_id", estimateIds)
    .order("position", { ascending: true });
  const options = (optionRows ?? []).map((r) => ({
    ...(r as EstimateOption),
    notes: null,
  }));
  const optionIds = options.map((o) => o.id);
  let lines: EstimateLineItem[] = [];
  if (optionIds.length) {
    const raw = await fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("estimate_line_items_customer")
        .select("*")
        .in("option_id", optionIds)
        .order("position", { ascending: true })
        .range(from, to),
    );
    lines = raw.map(asLine);
  }
  const linesByOption = new Map<string, EstimateLineItem[]>();
  for (const line of lines) {
    const arr = linesByOption.get(line.option_id) ?? [];
    arr.push(line);
    linesByOption.set(line.option_id, arr);
  }
  for (const option of options) {
    option.line_items = linesByOption.get(option.id) ?? [];
  }
  const optionsByEstimate = new Map<string, EstimateOption[]>();
  for (const option of options) {
    const arr = optionsByEstimate.get(option.estimate_id) ?? [];
    arr.push(option);
    optionsByEstimate.set(option.estimate_id, arr);
  }
  for (const estimate of estimates) {
    estimate.options = optionsByEstimate.get(estimate.id) ?? [];
  }
  return estimates;
}

export async function getPortalEstimate(id: string): Promise<Estimate | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates_customer")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const [withOptions] = await attachPortalOptions(supabase, [
    asEstimate(data as Record<string, unknown>),
  ]);
  return withOptions;
}

export async function listPortalEstimates(
  customerId: string,
): Promise<Estimate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimates_customer")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return attachPortalOptions(
    supabase,
    (data ?? []).map((r) => asEstimate(r as Record<string, unknown>)),
  );
}

export async function listPortalJobs(customerId: string): Promise<Job[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs_customer")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    ...(r as Job),
    assigned_to: null,
  }));
}

/**
 * Installer display names for confirmed portal jobs. Reads assigned_to via
 * service role AFTER jobs_customer ownership, and never sends the UUID to the
 * customer JWT / view.
 */
export async function listPortalInstallerNames(
  customerId: string,
  jobs: Pick<Job, "id" | "scheduled_date">[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const scheduledIds = jobs
    .filter((j) => j.scheduled_date)
    .map((j) => j.id);
  if (!scheduledIds.length) return names;
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("jobs")
    .select("id, assigned_to")
    .eq("customer_id", customerId)
    .in("id", scheduledIds);
  const ids = [
    ...new Set(
      (rows ?? [])
        .map((r) => r.assigned_to as string | null)
        .filter((id): id is string => !!id),
    ),
  ];
  if (!ids.length) return names;
  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);
  const byProfile = new Map<string, string>();
  for (const p of profs ?? []) {
    byProfile.set(p.id as string, (p.full_name as string) || "Your installer");
  }
  for (const r of rows ?? []) {
    const pid = r.assigned_to as string | null;
    if (pid && byProfile.has(pid)) {
      names.set(r.id as string, byProfile.get(pid)!);
    }
  }
  return names;
}

function mapPortalSnapshot(row: Record<string, unknown>): EstimateApprovalSnapshot {
  const payload = sanitizeApprovalPayloadForCustomer(
    row.payload as ApprovalSnapshotPayload,
  );
  return {
    id: row.id as string,
    estimate_id: row.estimate_id as string,
    version: Number(row.version),
    accepted_option_id: (row.accepted_option_id as string) ?? null,
    approved_at: row.approved_at as string,
    approval_source: row.approval_source as EstimateApprovalSnapshot["approval_source"],
    approved_by_user_id: null,
    approved_by_customer_id: (row.approved_by_customer_id as string) ?? null,
    payload,
    created_at: row.created_at as string,
  };
}

export async function getPortalApprovalSnapshot(
  estimateId: string,
): Promise<EstimateApprovalSnapshot | null> {
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates_customer")
    .select("current_approval_snapshot_id")
    .eq("id", estimateId)
    .maybeSingle();
  const sid = est?.current_approval_snapshot_id as string | null | undefined;
  if (sid) {
    const { data } = await supabase
      .from("estimate_approval_snapshots_customer")
      .select("*")
      .eq("id", sid)
      .maybeSingle();
    if (data) return mapPortalSnapshot(data as Record<string, unknown>);
  }
  const { data: latest } = await supabase
    .from("estimate_approval_snapshots_customer")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest ? mapPortalSnapshot(latest as Record<string, unknown>) : null;
}

export async function listPortalApprovalSnapshots(
  estimateId: string,
): Promise<EstimateApprovalSnapshot[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("estimate_approval_snapshots_customer")
    .select("*")
    .eq("estimate_id", estimateId)
    .order("version", { ascending: true });
  return (data ?? []).map((r) => mapPortalSnapshot(r as Record<string, unknown>));
}

export async function getPortalOrgSettings(): Promise<OrgSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("org_settings_customer")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  return {
    ...PORTAL_ORG_DEFAULTS,
    ...(data ?? {}),
    fuel_surcharge_pct: 0,
    freight_markup_pct: 0,
  };
}

export async function getPortalInvoiceScope(inv: {
  estimate_id: string | null;
  job_id: string | null;
}): Promise<{ scope: CustomerScope; narrative: string | null } | null> {
  if (inv.estimate_id) {
    const est = await getPortalEstimate(inv.estimate_id);
    const opts = est?.options ?? [];
    const chosen =
      opts.find((o) => o.id === est?.accepted_option_id) ?? opts[0] ?? null;
    if (est && chosen) {
      return {
        scope: buildCustomerScope(chosen.line_items ?? [], est.job_description),
        narrative: est.job_description,
      };
    }
  }
  if (inv.job_id) {
    const supabase = await createClient();
    const raw = await fetchAll<Record<string, unknown>>((from, to) =>
      supabase
        .from("job_line_items_customer")
        .select("*")
        .eq("job_id", inv.job_id)
        .order("position", { ascending: true })
        .range(from, to),
    );
    if (raw.length) {
      return {
        scope: buildCustomerScope(raw.map(asLine), null),
        narrative: null,
      };
    }
  }
  return null;
}

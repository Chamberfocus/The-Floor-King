import { docRef } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import {
  assessLifecycle,
  type DeleteImpact,
  type LifecycleFacts,
  type LifecycleRecordType,
  type LifecycleView,
} from "@/lib/record-lifecycle";

type Db = Awaited<ReturnType<typeof createClient>>;

const TABLE: Record<Exclude<LifecycleRecordType, "payment">, string> = {
  customer: "customers",
  estimate: "estimates",
  job: "jobs",
  invoice: "invoices",
  product: "products",
  supplier: "suppliers",
  installer: "install_crews",
};

const CODE_PREFIX: Record<Exclude<LifecycleRecordType, "payment">, string> = {
  customer: "CUS",
  estimate: "EST",
  job: "JOB",
  invoice: "INV",
  product: "PRD",
  supplier: "VND",
  installer: "CRW",
};

let schemaReady: boolean | null = null;

export async function lifecycleSchemaReady(db?: Db): Promise<boolean> {
  if (schemaReady != null) return schemaReady;
  const supabase = db ?? (await createClient());
  const { error } = await supabase.from("customers").select("archived_at").limit(1);
  if (!error) {
    schemaReady = true;
    return true;
  }
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "42703" || code === "PGRST204" || /archived_at/i.test(message)) {
    schemaReady = false;
    return false;
  }
  schemaReady = false;
  return false;
}

export function applyArchivedFilter<T extends { is: (c: string, v: null) => T; not: (c: string, op: string, v: null) => T }>(
  query: T,
  view: LifecycleView,
  ready: boolean,
): T {
  if (!ready || view === "all") return query;
  if (view === "archived") return query.not("archived_at", "is", null);
  return query.is("archived_at", null);
}

async function tally(
  db: Db,
  table: string,
  column: string,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extra?: (query: any) => any,
): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = db.from(table).select("id", { count: "exact", head: true }).eq(column, id);
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return 0;
    throw error;
  }
  return count ?? 0;
}

async function loadRow(
  db: Db,
  type: Exclude<LifecycleRecordType, "payment">,
  id: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.from(TABLE[type]).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Record<string, unknown> | null) ?? null;
}

function publicCode(type: Exclude<LifecycleRecordType, "payment">, row: Record<string, unknown>): string {
  if (type === "invoice" && typeof row.number === "string" && row.number.trim()) {
    return row.number.trim();
  }
  if (type === "product" && typeof row.sku === "string" && row.sku.trim()) {
    return row.sku.trim();
  }
  return docRef(CODE_PREFIX[type], String(row.id ?? ""));
}

export async function loadLifecycleFacts(
  type: LifecycleRecordType,
  id: string,
  db?: Db,
): Promise<LifecycleFacts> {
  const supabase = db ?? (await createClient());
  if (type === "payment") {
    const { data } = await supabase.from("payments").select("id").eq("id", id).maybeSingle();
    return {
      recordType: type,
      recordId: id,
      exists: Boolean(data),
      archivedAt: null,
      publicCode: data ? docRef("PAY", id) : null,
      status: null,
      counts: {},
      flags: {},
    };
  }
  const row = await loadRow(supabase, type, id);
  const base: LifecycleFacts = {
    recordType: type,
    recordId: id,
    exists: Boolean(row),
    archivedAt: row && typeof row.archived_at === "string" ? row.archived_at : null,
    publicCode: row ? publicCode(type, row) : null,
    status: row && typeof row.status === "string" ? row.status : null,
    counts: {},
    flags: {},
  };
  if (!row) return base;
  base.counts = await countsFor(supabase, type, id, row);
  base.flags = {
    scheduled: Boolean(row.scheduled_date),
  };
  return base;
}

async function countsFor(
  db: Db,
  type: Exclude<LifecycleRecordType, "payment">,
  id: string,
  row: Record<string, unknown>,
): Promise<Record<string, number>> {
  if (type === "customer") return customerCounts(db, id);
  if (type === "estimate") {
    const [jobs, invoices, deposits, purchaseOrders, snapshots, credits] = await Promise.all([
      tally(db, "jobs", "estimate_id", id),
      tally(db, "invoices", "estimate_id", id),
      tally(db, "customer_deposits", "estimate_id", id),
      tally(db, "purchase_orders", "estimate_id", id),
      tally(db, "estimate_approval_snapshots", "estimate_id", id),
      tally(db, "credit_memos", "estimate_id", id),
    ]);
    return {
      jobs,
      invoices,
      deposits,
      purchase_orders: purchaseOrders,
      approval_snapshots: snapshots,
      credit_memos: credits,
    };
  }
  if (type === "job") {
    const [
      invoices,
      signatures,
      labor,
      files,
      purchaseOrders,
      stock,
      installerBills,
      issues,
      service,
      orders,
      expenses,
      bills,
    ] = await Promise.all([
      tally(db, "invoices", "job_id", id),
      tally(db, "job_files", "job_id", id, (q) => q.eq("kind", "signature")),
      tally(db, "job_labor", "job_id", id),
      tally(db, "job_files", "job_id", id),
      tally(db, "purchase_orders", "job_id", id),
      tally(db, "stock_movements", "job_id", id),
      tally(db, "installer_bills", "job_id", id),
      tally(db, "job_issues", "job_id", id),
      tally(db, "service_callbacks", "job_id", id),
      tally(db, "orders", "job_id", id),
      tally(db, "expenses", "job_id", id),
      tally(db, "bills", "job_id", id),
    ]);
    return {
      invoices,
      payments: 0,
      signatures,
      labor,
      files,
      purchase_orders: purchaseOrders,
      stock_movements: stock,
      installer_bills: installerBills,
      job_issues: issues,
      service_callbacks: service,
      orders,
      expenses,
      bills,
    };
  }
  if (type === "invoice") {
    const [payments, credits, deposits, writeOffs, journal, items] = await Promise.all([
      tally(db, "payments", "invoice_id", id),
      tally(db, "credit_applications", "invoice_id", id),
      tally(db, "customer_deposit_applications", "invoice_id", id),
      tally(db, "invoice_write_offs", "invoice_id", id),
      tally(db, "journal_lines", "invoice_id", id),
      tally(db, "invoice_items", "invoice_id", id),
    ]);
    return {
      payments,
      credit_applications: credits,
      deposit_applications: deposits,
      write_offs: writeOffs,
      journal_lines: journal,
      deposits,
      items,
    };
  }
  if (type === "product") {
    const [lines, poItems, stock, rolls, orderItems, samples, vendors] = await Promise.all([
      tally(db, "estimate_line_items", "product_id", id),
      tally(db, "po_items", "product_id", id),
      tally(db, "stock_movements", "product_id", id),
      tally(db, "stock_rolls", "product_id", id),
      tally(db, "order_items", "product_id", id),
      tally(db, "sample_checkout_items", "product_id", id),
      tally(db, "product_vendors", "product_id", id),
    ]);
    return {
      estimate_lines: lines,
      po_items: poItems,
      stock_movements: stock,
      stock_rolls: rolls,
      order_items: orderItems,
      sample_items: samples,
      product_vendors: vendors,
    };
  }
  if (type === "supplier") {
    const [pos, bills, journal, opening, vendors] = await Promise.all([
      tally(db, "purchase_orders", "supplier_id", id),
      tally(db, "bills", "supplier_id", id),
      tally(db, "journal_lines", "vendor_id", id),
      tally(db, "opening_ap_items", "vendor_id", id),
      tally(db, "product_vendors", "vendor_id", id),
    ]);
    return {
      purchase_orders: pos,
      bills,
      journal_lines: journal,
      opening_ap: opening,
      product_vendors: vendors,
    };
  }
  const crewId = id;
  const [jobs, bills, labor] = await Promise.all([
    tally(db, "jobs", "assigned_crew_id", crewId),
    tally(db, "installer_bills", "crew_id", crewId),
    tally(db, "job_labor", "crew_id", crewId),
  ]);
  return { jobs, installer_bills: bills, labor };
}

async function customerCounts(db: Db, id: string): Promise<Record<string, number>> {
  const [
    draftEstimates,
    otherEstimates,
    invoices,
    payments,
    credits,
    refunds,
    deposits,
    depositApps,
    writeOffs,
    journal,
    opening,
    service,
    purchaseOrders,
    orders,
    stock,
    bills,
    expenses,
    signatures,
    installerBills,
    issues,
    snapshots,
    documents,
    appointments,
    messages,
    activities,
    samples,
    tasks,
    portals,
    poLinks,
    handoffs,
    areas,
    drafts,
    overrides,
    addresses,
    referrals,
  ] = await Promise.all([
    tally(db, "estimates", "customer_id", id, (q) => q.eq("status", "draft")),
    tally(db, "estimates", "customer_id", id, (q) => q.neq("status", "draft")),
    tally(db, "invoices", "customer_id", id),
    tally(db, "payments", "customer_id", id).catch(() => 0),
    tally(db, "credit_memos", "customer_id", id),
    tally(db, "refunds", "customer_id", id),
    tally(db, "customer_deposits", "customer_id", id),
    tally(db, "customer_deposit_applications", "customer_id", id).catch(() => 0),
    tally(db, "invoice_write_offs", "customer_id", id).catch(() => 0),
    tally(db, "journal_lines", "customer_id", id),
    tally(db, "opening_ar_items", "customer_id", id),
    tally(db, "service_callbacks", "customer_id", id),
    tally(db, "purchase_orders", "customer_id", id),
    tally(db, "orders", "customer_id", id),
    tally(db, "stock_movements", "customer_id", id),
    tally(db, "bills", "customer_id", id),
    tally(db, "expenses", "customer_id", id).catch(() => 0),
    tally(db, "job_files", "job_id", id).catch(() => 0),
    tally(db, "installer_bills", "customer_id", id).catch(() => 0),
    tally(db, "job_issues", "customer_id", id).catch(() => 0),
    tally(db, "estimate_approval_snapshots", "customer_id", id).catch(() => 0),
    tally(db, "documents", "customer_id", id),
    tally(db, "appointments", "customer_id", id),
    tally(db, "messages", "customer_id", id),
    tally(db, "activities", "customer_id", id),
    tally(db, "sample_checkouts", "customer_id", id),
    tally(db, "office_tasks", "customer_id", id),
    tally(db, "profiles", "customer_id", id),
    tally(db, "po_items", "for_customer_id", id),
    tally(db, "handoffs", "customer_id", id),
    tally(db, "customer_areas", "customer_id", id),
    tally(db, "estimate_drafts", "customer_id", id),
    tally(db, "step_overrides", "customer_id", id),
    tally(db, "service_addresses", "customer_id", id),
    tally(db, "customers", "referred_by_customer_id", id).catch(() => 0),
  ]);
  const { count: duplicateOverrides, error: duplicateError } = await db
    .from("customer_duplicate_overrides")
    .select("id", { count: "exact", head: true })
    .or(`created_customer_id.eq.${id},matched_customer_id.eq.${id}`);
  if (duplicateError && duplicateError.code !== "42P01" && duplicateError.code !== "PGRST205") {
    throw duplicateError;
  }
  const duplicateCount = duplicateError ? 0 : (duplicateOverrides ?? 0);
  const { count: approvedBy, error: approvedByError } = await db
    .from("estimate_approval_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("approved_by_customer_id", id);
  if (approvedByError && approvedByError.code !== "42P01" && approvedByError.code !== "PGRST205") {
    throw approvedByError;
  }
  const snapshotCount = snapshots + (approvedByError ? 0 : (approvedBy ?? 0));
  const { count: externalApprovals, error: externalApprovalError } = await db
    .from("estimates")
    .select("id", { count: "exact", head: true })
    .eq("approved_by_customer_id", id)
    .neq("customer_id", id);
  if (
    externalApprovalError &&
    externalApprovalError.code !== "42P01" &&
    externalApprovalError.code !== "PGRST205" &&
    externalApprovalError.code !== "42703"
  ) {
    throw externalApprovalError;
  }
  const approvalCount = snapshotCount + (externalApprovalError ? 0 : (externalApprovals ?? 0));
  const { data: jobs } = await db.from("jobs").select("id, status, scheduled_date").eq("customer_id", id);
  let safeJobs = 0;
  let protectedJobs = 0;
  const jobIds = (jobs ?? []).map((job) => job.id as string);
  for (const job of jobs ?? []) {
    const status = String(job.status ?? "");
    if (status === "unscheduled" && !job.scheduled_date) safeJobs += 1;
    else protectedJobs += 1;
  }
  if (jobIds.length) {
    const [files, labor, stockJobs, pos] = await Promise.all([
      db.from("job_files").select("job_id, kind").in("job_id", jobIds),
      db.from("job_labor").select("job_id").in("job_id", jobIds),
      db.from("stock_movements").select("job_id").in("job_id", jobIds),
      db.from("purchase_orders").select("job_id").in("job_id", jobIds),
    ]);
    const dirty = new Set<string>();
    for (const row of files.data ?? []) {
      dirty.add(row.job_id as string);
      if (row.kind === "signature") dirty.add(row.job_id as string);
    }
    for (const row of [...(labor.data ?? []), ...(stockJobs.data ?? []), ...(pos.data ?? [])]) {
      if (row.job_id) dirty.add(row.job_id as string);
    }
    safeJobs = (jobs ?? []).filter((job) => {
      const status = String(job.status ?? "");
      return status === "unscheduled" && !job.scheduled_date && !dirty.has(job.id as string);
    }).length;
    protectedJobs = (jobs ?? []).length - safeJobs;
  }
  const signatureCount = jobIds.length
    ? (
        await db
          .from("job_files")
          .select("id", { count: "exact", head: true })
          .in("job_id", jobIds)
          .eq("kind", "signature")
      ).count ?? signatures
    : 0;
  return {
    draft_estimates: draftEstimates,
    other_estimates: otherEstimates,
    invoices,
    payments,
    credit_memos: credits,
    refunds,
    deposits,
    deposit_applications: depositApps,
    write_offs: writeOffs,
    journal_lines: journal,
    opening_ar: opening,
    service_callbacks: service,
    purchase_orders: purchaseOrders,
    orders,
    stock_movements: stock,
    bills,
    expenses,
    signatures: signatureCount ?? 0,
    installer_bills: installerBills,
    job_issues: issues,
    approval_snapshots: approvalCount,
    protected_jobs: protectedJobs,
    safe_jobs: safeJobs,
    documents,
    appointments,
    messages,
    activities,
    sample_checkouts: samples,
    office_tasks: tasks,
    portal_profiles: portals,
    po_item_links: poLinks,
    duplicate_overrides: duplicateCount,
    referrals,
    handoffs,
    customer_areas: areas,
    estimate_drafts: drafts,
    step_overrides: overrides,
    service_addresses: addresses,
  };
}

export async function previewLifecycle(
  type: LifecycleRecordType,
  id: string,
): Promise<DeleteImpact> {
  const facts = await loadLifecycleFacts(type, id);
  return assessLifecycle(facts);
}

export async function drainLifecycleStorage(db: Db): Promise<void> {
  const { data, error } = await db
    .from("record_lifecycle_storage_outbox")
    .select("id, bucket, path, attempts")
    .is("completed_at", null)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error || !data?.length) return;
  for (const row of data) {
    const bucket = String(row.bucket ?? "");
    const path = String(row.path ?? "");
    if (!bucket || !path) continue;
    const removed = await db.storage.from(bucket).remove([path]);
    if (removed.error) {
      await db
        .from("record_lifecycle_storage_outbox")
        .update({
          attempts: Number(row.attempts ?? 0) + 1,
          last_error: "storage_remove_failed",
        })
        .eq("id", row.id);
      continue;
    }
    await db
      .from("record_lifecycle_storage_outbox")
      .update({ completed_at: new Date().toISOString(), last_error: null })
      .eq("id", row.id);
  }
}

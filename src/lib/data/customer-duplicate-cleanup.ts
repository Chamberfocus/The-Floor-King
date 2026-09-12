/**
 * Server helpers for duplicate review + owner-approved merge.
 * Mutations go through merge_customer_records (SQL transaction).
 */
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  EMPTY_CLEANUP_ACTIVITY,
  findCleanupDuplicateGroups,
  filterDuplicateGroups,
  hideMergedCustomers,
  mergeIdempotencyKey,
  previewMerge,
  snapshotFinancials,
  type ChosenProfileFields,
  type CleanupActivity,
  type CleanupConfidence,
  type CleanupCustomer,
  type DuplicateGroup,
  type ExclusionPair,
} from "@/lib/customer-duplicate-cleanup";
import { uniqueIds } from "@/lib/customer-list";
import { computeJobOpenBalance } from "@/lib/invoice-calc";

const IN_CHUNK = 80;

function chunkIds(ids: string[], size = IN_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function productionDuplicateAuditStatus(): "blocked" | "ready" {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!isSupabaseConfigured()) return "blocked";
  if (!service || service.includes("placeholder")) return "blocked";
  return "ready";
}

async function loadExclusions(): Promise<ExclusionPair[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_duplicate_exclusions")
    .select("customer_id_a, customer_id_b, reason, decided_by, decided_at");
  if (error) return [];
  return (data ?? []) as ExclusionPair[];
}

async function loadActivity(ids: string[]): Promise<Record<string, CleanupActivity>> {
  const out: Record<string, CleanupActivity> = {};
  for (const id of ids) out[id] = { ...EMPTY_CLEANUP_ACTIVITY };
  if (!ids.length) return out;
  const supabase = await createClient();

  for (const chunk of chunkIds(ids)) {
    const [
      jobs,
      estimates,
      invoices,
      appts,
      docs,
      notes,
      orders,
      deposits,
    ] = await Promise.all([
      supabase.from("jobs").select("id, customer_id, status, delivery_type, created_at, updated_at").in("customer_id", chunk),
      supabase.from("estimates").select("id, customer_id, created_at").in("customer_id", chunk),
      supabase.from("invoices").select("id, customer_id, status, tax_rate, counter_sale, created_at").in("customer_id", chunk),
      supabase.from("appointments").select("id, customer_id, starts_at").in("customer_id", chunk),
      supabase.from("documents").select("id, customer_id, created_at").in("customer_id", chunk),
      supabase.from("activities").select("id, customer_id, created_at").in("customer_id", chunk),
      supabase.from("orders").select("id, customer_id, created_at").in("customer_id", chunk),
      supabase.from("customer_deposits").select("id, customer_id, created_at").in("customer_id", chunk),
    ]);

    const jobRows = (jobs.data ?? []) as {
      id: string;
      customer_id: string;
      status: string | null;
      delivery_type: string | null;
      created_at?: string;
    }[];
    const invHeaders = (invoices.data ?? []) as {
      id: string;
      customer_id: string;
      status: string;
      tax_rate: number;
      counter_sale?: boolean;
      created_at?: string;
    }[];

    for (const j of jobRows) {
      const a = out[j.customer_id];
      if (!a) continue;
      a.jobCount += 1;
      if (["unscheduled", "scheduled", "in_progress"].includes((j.status ?? "").toLowerCase())) {
        a.openJobCount += 1;
      }
      if (j.delivery_type === "cash_carry") a.cashAndCarryCount += 1;
      if (j.created_at && (!a.lastActivityAt || j.created_at > a.lastActivityAt)) {
        a.lastActivityAt = j.created_at;
      }
    }
    for (const e of (estimates.data ?? []) as { customer_id: string; created_at?: string }[]) {
      const a = out[e.customer_id];
      if (!a) continue;
      a.estimateCount += 1;
      if (e.created_at && (!a.lastActivityAt || e.created_at > a.lastActivityAt)) {
        a.lastActivityAt = e.created_at;
      }
    }
    for (const row of (appts.data ?? []) as { customer_id: string; starts_at?: string }[]) {
      const a = out[row.customer_id];
      if (!a) continue;
      a.appointmentCount += 1;
      if (row.starts_at && (!a.lastActivityAt || row.starts_at > a.lastActivityAt)) {
        a.lastActivityAt = row.starts_at;
      }
    }
    for (const row of (docs.data ?? []) as { customer_id: string; created_at?: string }[]) {
      const a = out[row.customer_id];
      if (!a) continue;
      a.documentCount += 1;
      if (row.created_at && (!a.lastActivityAt || row.created_at > a.lastActivityAt)) {
        a.lastActivityAt = row.created_at;
      }
    }
    for (const row of (notes.data ?? []) as { customer_id: string; created_at?: string }[]) {
      const a = out[row.customer_id];
      if (!a) continue;
      a.noteCount += 1;
      if (row.created_at && (!a.lastActivityAt || row.created_at > a.lastActivityAt)) {
        a.lastActivityAt = row.created_at;
      }
    }
    for (const row of (orders.data ?? []) as { customer_id: string; created_at?: string }[]) {
      const a = out[row.customer_id];
      if (!a) continue;
      a.orderCount += 1;
      if (row.created_at && (!a.lastActivityAt || row.created_at > a.lastActivityAt)) {
        a.lastActivityAt = row.created_at;
      }
    }
    for (const row of (deposits.data ?? []) as { customer_id: string; created_at?: string }[]) {
      const a = out[row.customer_id];
      if (!a) continue;
      a.depositCount += 1;
      if (row.created_at && (!a.lastActivityAt || row.created_at > a.lastActivityAt)) {
        a.lastActivityAt = row.created_at;
      }
    }

    const invoiceIds = invHeaders.map((i) => i.id);
    const itemsBy = new Map<string, { quantity: number; rate: number }[]>();
    const paysBy = new Map<string, number>();
    const creditsBy = new Map<string, number>();
    const depositsBy = new Map<string, number>();
    const writeOffsBy = new Map<string, number>();
    if (invoiceIds.length) {
      const [itemRows, payRows, creditRows, depRows, woRows] = await Promise.all([
        supabase.from("invoice_items").select("invoice_id, quantity, rate").in("invoice_id", invoiceIds),
        supabase.from("payments").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
        supabase.from("credit_applications").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
        supabase.from("customer_deposit_applications").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
        supabase.from("invoice_write_offs").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
      ]);
      for (const it of itemRows.data ?? []) {
        const arr = itemsBy.get(it.invoice_id as string) ?? [];
        arr.push({ quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0 });
        itemsBy.set(it.invoice_id as string, arr);
      }
      for (const p of payRows.data ?? []) {
        if ((p.status ?? "active") === "void") continue;
        paysBy.set(
          p.invoice_id as string,
          (paysBy.get(p.invoice_id as string) ?? 0) + (Number(p.amount) || 0),
        );
      }
      for (const c of creditRows.data ?? []) {
        if ((c.status ?? "active") === "void") continue;
        creditsBy.set(
          c.invoice_id as string,
          (creditsBy.get(c.invoice_id as string) ?? 0) + (Number(c.amount) || 0),
        );
      }
      for (const d of depRows.data ?? []) {
        if ((d.status ?? "active") === "void") continue;
        depositsBy.set(
          d.invoice_id as string,
          (depositsBy.get(d.invoice_id as string) ?? 0) + (Number(d.amount) || 0),
        );
      }
      for (const w of woRows.data ?? []) {
        if ((w.status ?? "active") === "void") continue;
        writeOffsBy.set(
          w.invoice_id as string,
          (writeOffsBy.get(w.invoice_id as string) ?? 0) + (Number(w.amount) || 0),
        );
      }
    }

    const byCustomer = new Map<string, typeof invHeaders>();
    for (const inv of invHeaders) {
      const a = out[inv.customer_id];
      if (!a) continue;
      a.invoiceCount += 1;
      if (inv.counter_sale) a.cashAndCarryCount += 1;
      const list = byCustomer.get(inv.customer_id) ?? [];
      list.push(inv);
      byCustomer.set(inv.customer_id, list);
    }
    for (const [cid, list] of byCustomer) {
      const a = out[cid];
      if (!a) continue;
      a.openAr = computeJobOpenBalance(
        list.map((inv) => ({
          id: inv.id,
          status: inv.status,
          tax_rate: inv.tax_rate,
          items: itemsBy.get(inv.id) ?? [],
          amountPaid: paysBy.get(inv.id) ?? 0,
          appliedCredits: creditsBy.get(inv.id) ?? 0,
          appliedDeposits: depositsBy.get(inv.id) ?? 0,
          appliedWriteOffs: writeOffsBy.get(inv.id) ?? 0,
        })),
      ).balance;
    }
  }

  return out;
}

export async function listDuplicateCandidateGroups(opts: {
  confidence?: CleanupConfidence | "all" | "ignored" | "merged";
  samePhone?: boolean;
  sameEmail?: boolean;
  sameNameAddress?: boolean;
}): Promise<{
  groups: DuplicateGroup[];
  totalCustomers: number;
  exclusions: ExclusionPair[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select(
      "id, full_name, company, phone, email, street, city, state, zip, notes, assigned_to, created_at, merged_into_customer_id, merged_at, merged_by, merge_reason",
    )
    .order("created_at", { ascending: true });
  if (error) {
    if (
      (error.message ?? "").includes("merged_into") ||
      (error.message ?? "").includes("customer_duplicate")
    ) {
      return { groups: [], totalCustomers: 0, exclusions: [] };
    }
    throw error;
  }
  const all = (data ?? []) as CleanupCustomer[];
  const totalCustomers = hideMergedCustomers(all).length;
  const exclusions = await loadExclusions();
  const active = hideMergedCustomers(all);
  const activity = await loadActivity(active.map((c) => c.id));
  const salespersonIds = uniqueIds(active.map((c) => c.assigned_to));
  const names: Record<string, string> = {};
  if (salespersonIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", salespersonIds);
    for (const p of profiles ?? []) {
      names[p.id as string] = (p.full_name as string) || (p.email as string);
    }
  }
  let groups = findCleanupDuplicateGroups({
    customers: active,
    activity,
    exclusions,
    salespersonNames: names,
  });

  if (opts.confidence === "ignored") {
    groups = exclusions.map((e) => {
      const a = all.find((c) => c.id === e.customer_id_a);
      const b = all.find((c) => c.id === e.customer_id_b);
      const members = [a, b].filter(Boolean) as CleanupCustomer[];
      return {
        id: `ignored:${e.customer_id_a},${e.customer_id_b}`,
        confidence: "low" as const,
        reasons: [],
        label: "Not a duplicate",
        memberIds: members.map((m) => m.id),
        members: members.map((m) => ({
          ...m,
          ...(activity[m.id] ?? EMPTY_CLEANUP_ACTIVITY),
        })),
        suppressed: true,
      };
    });
  } else if (opts.confidence === "merged") {
    const merged = all.filter((c) => c.merged_into_customer_id);
    groups = merged.map((dup) => {
      const surv = all.find((c) => c.id === dup.merged_into_customer_id);
      const members = [surv, dup].filter(Boolean) as CleanupCustomer[];
      return {
        id: `merged:${dup.merged_into_customer_id},${dup.id}`,
        confidence: "high" as const,
        reasons: [],
        label: "Already merged",
        memberIds: members.map((m) => m.id),
        members: members.map((m) => ({
          ...m,
          ...(activity[m.id] ?? EMPTY_CLEANUP_ACTIVITY),
        })),
        merged: true,
      };
    });
  } else {
    groups = filterDuplicateGroups(groups, opts);
  }

  return { groups, totalCustomers, exclusions };
}

export async function getMergePreview(survivorId: string, duplicateId: string) {
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select(
      "id, full_name, company, phone, email, street, city, state, zip, notes, assigned_to, created_at, merged_into_customer_id, merge_reason",
    )
    .in("id", [survivorId, duplicateId]);
  const rows = (customers ?? []) as CleanupCustomer[];
  const survivor = rows.find((c) => c.id === survivorId) ?? null;
  const duplicate = rows.find((c) => c.id === duplicateId) ?? null;

  const [
    jobs,
    estimates,
    invoices,
    deposits,
    credits,
    refunds,
    orders,
    appointments,
    documents,
    notes,
    portals,
    drafts,
  ] = await Promise.all([
    supabase.from("jobs").select("id, customer_id, delivery_type, status").in("customer_id", [survivorId, duplicateId]),
    supabase.from("estimates").select("id, customer_id").in("customer_id", [survivorId, duplicateId]),
    supabase.from("invoices").select("id, customer_id, status, tax_rate, counter_sale").in("customer_id", [survivorId, duplicateId]),
    supabase.from("customer_deposits").select("id, customer_id, job_id, estimate_id, amount, status").in("customer_id", [survivorId, duplicateId]),
    supabase.from("credit_memos").select("id, customer_id, amount").in("customer_id", [survivorId, duplicateId]),
    supabase.from("refunds").select("id, customer_id, amount").in("customer_id", [survivorId, duplicateId]),
    supabase.from("orders").select("id, customer_id").in("customer_id", [survivorId, duplicateId]),
    supabase.from("appointments").select("id, customer_id").in("customer_id", [survivorId, duplicateId]),
    supabase.from("documents").select("id, customer_id, path").in("customer_id", [survivorId, duplicateId]),
    supabase.from("activities").select("id, customer_id, body").in("customer_id", [survivorId, duplicateId]),
    supabase.from("profiles").select("id, customer_id, role").in("customer_id", [survivorId, duplicateId]).eq("role", "customer"),
    supabase.from("estimate_drafts").select("customer_id").in("customer_id", [survivorId, duplicateId]),
  ]);

  const invHeaders = (invoices.data ?? []) as {
    id: string;
    customer_id: string;
    status: string;
    tax_rate: number;
    counter_sale?: boolean;
  }[];
  const invoiceIds = invHeaders.map((i) => i.id);
  const itemsBy = new Map<string, { quantity: number; rate: number }[]>();
  const paysBy = new Map<string, { amount: number; status: string | null }[]>();
  const creditsBy = new Map<string, { amount: number; status: string | null }[]>();
  const depAppBy = new Map<string, number>();
  const woBy = new Map<string, number>();
  if (invoiceIds.length) {
    const [itemRows, payRows, creditRows, depRows, woRows] = await Promise.all([
      supabase.from("invoice_items").select("invoice_id, quantity, rate").in("invoice_id", invoiceIds),
      supabase.from("payments").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
      supabase.from("credit_applications").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
      supabase.from("customer_deposit_applications").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
      supabase.from("invoice_write_offs").select("invoice_id, amount, status").in("invoice_id", invoiceIds),
    ]);
    for (const it of itemRows.data ?? []) {
      const arr = itemsBy.get(it.invoice_id as string) ?? [];
      arr.push({ quantity: Number(it.quantity) || 0, rate: Number(it.rate) || 0 });
      itemsBy.set(it.invoice_id as string, arr);
    }
    for (const p of payRows.data ?? []) {
      const arr = paysBy.get(p.invoice_id as string) ?? [];
      arr.push({ amount: Number(p.amount) || 0, status: (p.status as string) ?? "active" });
      paysBy.set(p.invoice_id as string, arr);
    }
    for (const c of creditRows.data ?? []) {
      const arr = creditsBy.get(c.invoice_id as string) ?? [];
      arr.push({ amount: Number(c.amount) || 0, status: (c.status as string) ?? "active" });
      creditsBy.set(c.invoice_id as string, arr);
    }
    for (const d of depRows.data ?? []) {
      if ((d.status ?? "active") === "void") continue;
      depAppBy.set(
        d.invoice_id as string,
        (depAppBy.get(d.invoice_id as string) ?? 0) + (Number(d.amount) || 0),
      );
    }
    for (const w of woRows.data ?? []) {
      if ((w.status ?? "active") === "void") continue;
      woBy.set(
        w.invoice_id as string,
        (woBy.get(w.invoice_id as string) ?? 0) + (Number(w.amount) || 0),
      );
    }
  }

  const state = {
    customers: rows,
    jobs: (jobs.data ?? []) as { id: string; customer_id: string; delivery_type?: string | null; status?: string | null }[],
    estimates: (estimates.data ?? []) as { id: string; customer_id: string }[],
    invoices: invHeaders.map((inv) => ({
      ...inv,
      items: itemsBy.get(inv.id) ?? [],
      payments: paysBy.get(inv.id) ?? [],
      creditApplications: creditsBy.get(inv.id) ?? [],
      appliedDeposits: depAppBy.get(inv.id) ?? 0,
      appliedWriteOffs: woBy.get(inv.id) ?? 0,
    })),
    deposits: ((deposits.data ?? []) as {
      id: string;
      customer_id: string;
      job_id: string | null;
      estimate_id: string | null;
      amount: number;
    }[]).map((d) => ({ ...d, unapplied: Number(d.amount) || 0 })),
    creditMemos: (credits.data ?? []) as { id: string; customer_id: string; amount: number }[],
    refunds: (refunds.data ?? []) as { id: string; customer_id: string; amount: number }[],
    writeOffs: [],
    orders: (orders.data ?? []) as { id: string; customer_id: string }[],
    appointments: (appointments.data ?? []) as { id: string; customer_id: string }[],
    documents: (documents.data ?? []) as { id: string; customer_id: string; path: string }[],
    notes: (notes.data ?? []) as { id: string; customer_id: string; body: string }[],
    portalProfiles: (portals.data ?? []) as { id: string; customer_id: string; role: string }[],
    estimateDrafts: (drafts.data ?? []) as { customer_id: string }[],
    exclusions: [],
    mergeHistory: [],
    locks: new Set<string>(),
    accountingPostings: 0,
    accountingEnabled: false,
  };

  const preview = previewMerge({
    state,
    survivorId,
    duplicateId,
  });
  const portalConflict =
    state.portalProfiles.some((p) => p.customer_id === survivorId) &&
    state.portalProfiles.some((p) => p.customer_id === duplicateId);
  const draftConflict =
    state.estimateDrafts.some((d) => d.customer_id === survivorId) &&
    state.estimateDrafts.some((d) => d.customer_id === duplicateId);

  return {
    survivor,
    duplicate,
    preview,
    portalConflict,
    draftConflict,
    combinedFinancials: preview.combinedFinancials,
    snapshot: snapshotFinancials(state.invoices),
  };
}

export async function getCustomerMergeHistory(customerId: string): Promise<
  {
    duplicate_customer_id: string;
    performed_at: string;
    performed_by: string | null;
    reason: string;
  }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer_merge_history")
    .select("duplicate_customer_id, performed_at, performed_by, reason")
    .eq("survivor_customer_id", customerId)
    .order("performed_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as {
    duplicate_customer_id: string;
    performed_at: string;
    performed_by: string | null;
    reason: string;
  }[];
}

export async function excludeDuplicatePair(args: {
  a: string;
  b: string;
  reason: string;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("customer_duplicate_exclusions").insert({
    customer_id_a: args.a,
    customer_id_b: args.b,
    reason: args.reason,
    decided_by: args.actorId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function executeMergeRpc(args: {
  survivorId: string;
  duplicateId: string;
  chosen: ChosenProfileFields;
  reason: string;
  idempotencyKey?: string;
}): Promise<{ ok: boolean; error?: string; code?: string; duplicate?: boolean }> {
  const supabase = await createClient();
  const key = args.idempotencyKey || mergeIdempotencyKey(args.survivorId, args.duplicateId);
  const { data, error } = await supabase.rpc("merge_customer_records", {
    p_survivor_customer_id: args.survivorId,
    p_duplicate_customer_id: args.duplicateId,
    p_chosen_fields: args.chosen,
    p_reason: args.reason,
    p_idempotency_key: key,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string; code?: string; duplicate?: boolean } | null;
  if (!row || row.ok === false) {
    return {
      ok: false,
      error: row?.error || "Merge was blocked.",
      code: row?.code,
    };
  }
  return { ok: true, duplicate: !!row.duplicate };
}

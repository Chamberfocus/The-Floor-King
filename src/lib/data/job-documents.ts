import { getEstimate } from "./estimates";
import { listInvoicesForJob, getJobOpenBalance, amountPaid } from "./invoices";
import { listPurchaseOrdersForJob } from "./purchase-orders";
import { getJobSatisfaction } from "./jobs";
import { getMeasurementDocuments } from "./documents";
import { getProfileNames } from "./customers";
import { buildJobScope } from "@/lib/job-scope";
import { optionTotals } from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import { poTotal } from "@/lib/po-calc";
import { formatMoney } from "@/lib/format";
import type { JobDetail } from "./jobs";

export type DocTone = "neutral" | "good" | "warn" | "info";

/** One row in the job's Documents tab. Backed by a real record (estimate /
 *  invoice / PO / file) or generated live from the job (work order / staging). */
export interface JobDocument {
  key: string;
  type:
    | "estimate"
    | "invoice"
    | "po"
    | "work_order"
    | "staging"
    | "completion"
    | "measurement";
  title: string;
  subtitle: string | null;
  date: string | null;
  createdBy: string | null;
  status: string | null;
  tone: DocTone;
  amount: number | null;
  href: string | null; // "open full page" for record-backed docs
  print: "work_order" | "staging" | null; // generated → print action
  tab: string | null; // jump to a job tab (completion, etc.)
  fileUrl: string | null; // direct-open (measurement image / pdf)
}

export interface JobDocGroup {
  key: string;
  label: string;
  items: JobDocument[];
}

export interface JobDocsResult {
  groups: JobDocGroup[];
  jobTotal: number | null; // sold value (accepted estimate option)
  balance: number | null;
  hasInvoice: boolean;
  estimateDate: string | null; // for the glance band
  estimatorName: string | null;
}

const EST_STATUS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  declined: "Declined",
  changes_requested: "Changes requested",
};
const estTone = (s: string): DocTone =>
  s === "approved" ? "good" : s === "declined" ? "warn" : s === "sent" ? "info" : "neutral";

/**
 * Every document tied to a job, grouped by type (each group always present so a
 * missing type reads as "None yet"). Reads real records live — no copies.
 */
export async function listJobDocuments(job: JobDetail): Promise<JobDocsResult> {
  const [estimate, invoices, pos, satisfaction, measureDocs, balInfo] =
    await Promise.all([
      job.estimate_id ? getEstimate(job.estimate_id) : Promise.resolve(null),
      listInvoicesForJob(job.id),
      listPurchaseOrdersForJob(job.id),
      getJobSatisfaction(job.id),
      job.customer_id
        ? getMeasurementDocuments(job.customer_id)
        : Promise.resolve([]),
      getJobOpenBalance(job.id),
    ]);

  const scope = buildJobScope(job.line_items, job.notes);
  const hasScope =
    scope.rooms.length > 0 ||
    scope.wholeJob.products.length > 0 ||
    scope.wholeJob.labor.length > 0;
  const hasMaterials = job.line_items.some(
    (l) => l.category !== "labor" && l.line_type !== "flat",
  );

  const creatorIds = Array.from(
    new Set(
      [
        estimate?.created_by,
        ...invoices.map((i) => i.created_by),
        ...pos.map((p) => p.created_by),
      ].filter(Boolean) as string[],
    ),
  );
  const names = creatorIds.length ? await getProfileNames(creatorIds) : {};
  const nm = (id: string | null | undefined) => (id ? (names[id] ?? null) : null);

  // --- Estimates (+ the job's sold value) ---
  let jobTotal: number | null = null;
  const estimates: JobDocument[] = [];
  if (estimate) {
    const opts = estimate.options ?? [];
    const acc =
      opts.find((o) => o.id === estimate.accepted_option_id) ?? opts[0] ?? null;
    jobTotal = acc
      ? optionTotals(acc.line_items ?? [], estimate.tax_rate ?? 0).total
      : null;
    estimates.push({
      key: `est-${estimate.id}`,
      type: "estimate",
      title: estimate.title || "Estimate",
      subtitle: acc ? `${opts.length} option${opts.length === 1 ? "" : "s"}` : null,
      date: estimate.created_at,
      createdBy: nm(estimate.created_by),
      status: EST_STATUS[estimate.status] ?? estimate.status,
      tone: estTone(estimate.status),
      amount: jobTotal,
      href: `/estimates/${estimate.id}`,
      print: null,
      tab: null,
      fileUrl: null,
    });
  }

  // --- Invoices ---
  const invoiceDocs: JobDocument[] = invoices.map((inv) => {
    const paid = amountPaid(inv);
    const t = invoiceTotals(inv.items ?? [], inv.tax_rate ?? 0, paid);
    const st =
      t.balance <= 0.005
        ? { s: "Paid ✓", tone: "good" as DocTone }
        : paid > 0
          ? { s: `${formatMoney(t.balance)} due`, tone: "warn" as DocTone }
          : { s: "Unpaid", tone: "info" as DocTone };
    return {
      key: `inv-${inv.id}`,
      type: "invoice",
      title: `Invoice${inv.number ? ` #${inv.number}` : ""}`,
      subtitle: null,
      date: inv.issue_date ?? inv.created_at,
      createdBy: nm(inv.created_by),
      status: st.s,
      tone: st.tone,
      amount: t.total,
      href: `/invoices/${inv.id}`,
      print: null,
      tab: null,
      fileUrl: null,
    };
  });

  // --- Purchase orders ---
  const poDocs: JobDocument[] = pos.map((po) => ({
    key: `po-${po.id}`,
    type: "po",
    title: `PO — ${po.supplier || "vendor"}`,
    subtitle: po.eta_date ? `needed ${po.eta_date}` : null,
    date: po.created_at,
    createdBy: nm(po.created_by),
    status: po.status ? po.status.charAt(0).toUpperCase() + po.status.slice(1) : null,
    tone:
      po.status === "received" ? "good" : po.status === "ordered" ? "info" : "neutral",
    amount: poTotal(po.items ?? []),
    href: `/purchase-orders/${po.id}`,
    print: null,
    tab: null,
    fileUrl: null,
  }));

  // --- Generated: installation work order ---
  const generated: JobDocument[] = [];
  if (hasScope) {
    generated.push({
      key: "wo",
      type: "work_order",
      title: "Installation work order",
      subtitle: `${scope.rooms.length} room${scope.rooms.length === 1 ? "" : "s"}`,
      date: job.created_at,
      createdBy: nm(estimate?.created_by),
      status: "Ready",
      tone: "good",
      amount: null,
      href: null,
      print: "work_order",
      tab: "work_order",
      fileUrl: null,
    });
  }
  // --- Generated: warehouse staging sheet ---
  if (hasMaterials) {
    generated.push({
      key: "staging",
      type: "staging",
      title: "Warehouse staging sheet",
      subtitle: job.staging_location ? `staged at ${job.staging_location}` : null,
      date: job.warehouse_submitted_at ?? job.created_at,
      createdBy: null,
      status: job.warehouse_ready_at
        ? "Staged ✓"
        : job.warehouse_submitted_at
          ? "In prep"
          : "Not sent",
      tone: job.warehouse_ready_at ? "good" : "neutral",
      amount: null,
      href: null,
      print: "staging",
      tab: "warehouse",
      fileUrl: null,
    });
  }

  // --- Completion & balance ---
  const completion: JobDocument[] = [];
  completion.push({
    key: "completion",
    type: "completion",
    title: "Completion / satisfaction",
    subtitle: satisfaction?.rating ? `${satisfaction.rating}★` : null,
    date: satisfaction?.signed_at ?? null,
    createdBy: satisfaction?.signed_name ?? null,
    status: satisfaction || (job.status === "completed") ? "Signed ✓" : "Pending",
    tone: satisfaction ? "good" : "neutral",
    amount: null,
    href: null,
    print: null,
    tab: "completion",
    fileUrl: null,
  });
  if (balInfo.hasInvoice) {
    completion.push({
      key: "balance",
      type: "completion",
      title: "Balance / collection",
      subtitle: null,
      date: null,
      createdBy: null,
      status: balInfo.balance <= 0.005 ? "Paid in full" : `${formatMoney(balInfo.balance)} due`,
      tone: balInfo.balance <= 0.005 ? "good" : "warn",
      amount: balInfo.balance > 0 ? balInfo.balance : null,
      href: balInfo.invoiceId ? `/invoices/${balInfo.invoiceId}` : null,
      print: null,
      tab: "money",
      fileUrl: null,
    });
  }

  // --- Measurements & diagrams ---
  const measurements: JobDocument[] = measureDocs.map((d) => ({
    key: `meas-${d.id}`,
    type: "measurement",
    title: d.name || "Measurement / diagram",
    subtitle: null,
    date: d.created_at ?? null,
    createdBy: null,
    status: null,
    tone: "neutral",
    amount: null,
    href: null,
    print: null,
    tab: null,
    fileUrl: d.url ?? null,
  }));

  const groups: JobDocGroup[] = [
    { key: "estimates", label: "Estimates", items: estimates },
    { key: "invoices", label: "Invoices", items: invoiceDocs },
    { key: "pos", label: "Purchase orders", items: poDocs },
    { key: "generated", label: "Work order & staging", items: generated },
    { key: "completion", label: "Completion & balance", items: completion },
    { key: "measurements", label: "Measurements & diagrams", items: measurements },
  ];

  return {
    groups,
    jobTotal,
    balance: balInfo.balance,
    hasInvoice: balInfo.hasInvoice,
    estimateDate: estimate?.created_at ?? null,
    estimatorName: nm(estimate?.created_by),
  };
}

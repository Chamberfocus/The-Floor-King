/**
 * Record lifecycle decisions.
 *
 * Archive is organizational. Delete forever is an administrator action that
 * this module either allows with an explicit impact list or blocks. Financial
 * history is never a delete candidate. The browser preview is not authority:
 * the server action and the database function both reassess before a delete.
 */

export const LIFECYCLE_RECORD_TYPES = [
  "customer",
  "estimate",
  "job",
  "invoice",
  "product",
  "supplier",
  "installer",
  "payment",
] as const;

export type LifecycleRecordType = (typeof LIFECYCLE_RECORD_TYPES)[number];

export type LifecycleView = "active" | "archived" | "all";

export type ImpactLine = {
  key: string;
  label: string;
  count: number;
};

export type DeleteImpact = {
  recordType: LifecycleRecordType;
  recordId: string;
  exists: boolean;
  archived: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canDeleteForever: boolean;
  confirmPhrase: string;
  blockingReasons: string[];
  willDelete: ImpactLine[];
  willDetach: ImpactLine[];
  willPreserve: ImpactLine[];
};

export type LifecycleFacts = {
  recordType: LifecycleRecordType;
  recordId: string;
  exists: boolean;
  archivedAt: string | null;
  /** Non-PII code such as EST-1A2B3C or an invoice number. Never a person name. */
  publicCode: string | null;
  status: string | null;
  counts: Record<string, number>;
  flags: Record<string, boolean>;
};

const ARCHIVE_TYPES = new Set<LifecycleRecordType>([
  "customer",
  "estimate",
  "job",
  "invoice",
  "product",
  "supplier",
  "installer",
]);

export function isLifecycleRecordType(value: string): value is LifecycleRecordType {
  return (LIFECYCLE_RECORD_TYPES as readonly string[]).includes(value);
}

export function parseLifecycleView(value: string | undefined): LifecycleView {
  if (value === "archived" || value === "all") return value;
  return "active";
}

export function confirmPhrase(publicCode: string | null | undefined): string {
  const code = (publicCode ?? "").trim();
  return code ? `DELETE ${code}` : "DELETE";
}

export function phraseMatches(expected: string, typed: string | null | undefined): boolean {
  return (typed ?? "").trim().toUpperCase() === expected.trim().toUpperCase();
}

function count(facts: LifecycleFacts, key: string): number {
  const value = facts.counts[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function line(key: string, label: string, n: number): ImpactLine | null {
  if (n <= 0) return null;
  return { key, label, count: n };
}

function lines(items: Array<ImpactLine | null>): ImpactLine[] {
  return items.filter((item): item is ImpactLine => item != null);
}

function blocked(
  facts: LifecycleFacts,
  blocking: ImpactLine[],
  preserve: ImpactLine[],
  removable: ImpactLine[],
): DeleteImpact {
  const phrase = confirmPhrase(facts.publicCode);
  const archived = Boolean(facts.archivedAt);
  const archivable = facts.exists && ARCHIVE_TYPES.has(facts.recordType);
  return {
    recordType: facts.recordType,
    recordId: facts.recordId,
    exists: facts.exists,
    archived,
    canArchive: archivable && !archived,
    canRestore: archivable && archived,
    canDeleteForever: facts.exists && blocking.length === 0 && facts.recordType !== "payment",
    confirmPhrase: phrase,
    blockingReasons: blocking.map((item) => item.label),
    willDelete: blocking.length === 0 ? removable : [],
    willDetach: [],
    willPreserve: preserve,
  };
}

function customerImpact(facts: LifecycleFacts): DeleteImpact {
  const protectedLines = lines([
    line("invoices", "financial or draft invoices", count(facts, "invoices")),
    line("payments", "payments", count(facts, "payments")),
    line("credit_memos", "credit memos", count(facts, "credit_memos")),
    line("refunds", "refunds", count(facts, "refunds")),
    line("deposits", "deposits", count(facts, "deposits")),
    line("deposit_applications", "deposit applications", count(facts, "deposit_applications")),
    line("write_offs", "write-offs", count(facts, "write_offs")),
    line("journal_lines", "journal lines", count(facts, "journal_lines")),
    line("opening_ar", "opening receivable items", count(facts, "opening_ar")),
    line("service_callbacks", "service callbacks", count(facts, "service_callbacks")),
    line("purchase_orders", "purchase orders", count(facts, "purchase_orders")),
    line("orders", "orders, including historical ones", count(facts, "orders")),
    line("stock_movements", "inventory movements", count(facts, "stock_movements")),
    line("bills", "vendor bills", count(facts, "bills")),
    line("expenses", "expenses", count(facts, "expenses")),
    line("signatures", "signatures", count(facts, "signatures")),
    line("installer_bills", "installer labor bills", count(facts, "installer_bills")),
    line("job_issues", "job issues", count(facts, "job_issues")),
    line("other_estimates", "estimates that are not drafts", count(facts, "other_estimates")),
    line("protected_jobs", "jobs with schedule or work history", count(facts, "protected_jobs")),
    line("approval_snapshots", "approved estimate snapshots", count(facts, "approval_snapshots")),
    line("sample_checkouts", "sample checkouts", count(facts, "sample_checkouts")),
    line("office_tasks", "tasks", count(facts, "office_tasks")),
    line("portal_profiles", "portal logins", count(facts, "portal_profiles")),
    line("po_item_links", "purchase lines attributed to this customer", count(facts, "po_item_links")),
    line("duplicate_overrides", "duplicate-review records", count(facts, "duplicate_overrides")),
    line("referrals", "other customers who name this account as referrer", count(facts, "referrals")),
  ]);
  const removable = lines([
    line("draft_estimates", "draft estimates", count(facts, "draft_estimates")),
    line("safe_jobs", "unstarted jobs with no history", count(facts, "safe_jobs")),
    line("documents", "uploaded files", count(facts, "documents")),
    line("appointments", "appointments", count(facts, "appointments")),
    line("messages", "messages", count(facts, "messages")),
    line("activities", "activity rows", count(facts, "activities")),
    line("handoffs", "workflow handoffs", count(facts, "handoffs")),
    line("customer_areas", "saved room measurements", count(facts, "customer_areas")),
    line("estimate_drafts", "in-progress questionnaire drafts", count(facts, "estimate_drafts")),
    line("step_overrides", "checklist overrides", count(facts, "step_overrides")),
    line("service_addresses", "extra service addresses", count(facts, "service_addresses")),
    line("customer", "this customer record", facts.exists ? 1 : 0),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function estimateImpact(facts: LifecycleFacts): DeleteImpact {
  const status = (facts.status ?? "").toLowerCase();
  const notDraft = facts.exists && status !== "draft";
  const protectedLines = lines([
    notDraft ? { key: "status", label: "this estimate is not a draft", count: 1 } : null,
    line("jobs", "linked jobs", count(facts, "jobs")),
    line("invoices", "linked invoices", count(facts, "invoices")),
    line("deposits", "deposits", count(facts, "deposits")),
    line("purchase_orders", "purchase orders", count(facts, "purchase_orders")),
    line("approval_snapshots", "approval snapshots", count(facts, "approval_snapshots")),
    line("credit_memos", "credit memos", count(facts, "credit_memos")),
  ]);
  const removable = lines([
    line("estimate", "this draft estimate and its options", facts.exists ? 1 : 0),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function jobImpact(facts: LifecycleFacts): DeleteImpact {
  const status = (facts.status ?? "").toLowerCase();
  const started = facts.exists && status !== "unscheduled";
  const dated = facts.exists && facts.flags.scheduled === true;
  const protectedLines = lines([
    started ? { key: "status", label: "this job is not unstarted", count: 1 } : null,
    dated ? { key: "scheduled", label: "this job has a schedule date", count: 1 } : null,
    line("invoices", "invoices", count(facts, "invoices")),
    line("payments", "payments", count(facts, "payments")),
    line("signatures", "signatures", count(facts, "signatures")),
    line("labor", "labor records", count(facts, "labor")),
    line("files", "job files", count(facts, "files")),
    line("purchase_orders", "purchase orders", count(facts, "purchase_orders")),
    line("stock_movements", "inventory movements", count(facts, "stock_movements")),
    line("installer_bills", "installer bills", count(facts, "installer_bills")),
    line("job_issues", "job issues", count(facts, "job_issues")),
    line("service_callbacks", "service callbacks", count(facts, "service_callbacks")),
    line("orders", "orders", count(facts, "orders")),
    line("expenses", "expenses", count(facts, "expenses")),
    line("bills", "vendor bills", count(facts, "bills")),
  ]);
  const removable = lines([
    line("job", "this unstarted job", facts.exists && protectedLines.length === 0 ? 1 : 0),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function invoiceImpact(facts: LifecycleFacts): DeleteImpact {
  const status = (facts.status ?? "").toLowerCase();
  const notDraft = facts.exists && status !== "draft";
  const protectedLines = lines([
    notDraft ? { key: "status", label: "this invoice is not an unissued draft", count: 1 } : null,
    line("payments", "payments", count(facts, "payments")),
    line("credit_applications", "credit applications", count(facts, "credit_applications")),
    line("deposit_applications", "deposit applications", count(facts, "deposit_applications")),
    line("write_offs", "write-offs", count(facts, "write_offs")),
    line("journal_lines", "journal lines", count(facts, "journal_lines")),
    line("deposits", "deposits applied to this invoice", count(facts, "deposits")),
  ]);
  const removable = lines([
    line("invoice", "this draft invoice", facts.exists ? 1 : 0),
    line("items", "draft line items", count(facts, "items")),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function productImpact(facts: LifecycleFacts): DeleteImpact {
  const protectedLines = lines([
    line("estimate_lines", "estimate lines", count(facts, "estimate_lines")),
    line("po_items", "purchase order lines", count(facts, "po_items")),
    line("stock_movements", "inventory movements", count(facts, "stock_movements")),
    line("stock_rolls", "inventory rolls", count(facts, "stock_rolls")),
    line("order_items", "order lines", count(facts, "order_items")),
    line("sample_items", "sample checkouts", count(facts, "sample_items")),
  ]);
  const removable = lines([
    line("product", "this unused product", facts.exists ? 1 : 0),
    line("product_vendors", "vendor links with no purchase history", count(facts, "product_vendors")),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function supplierImpact(facts: LifecycleFacts): DeleteImpact {
  const protectedLines = lines([
    line("purchase_orders", "purchase orders", count(facts, "purchase_orders")),
    line("bills", "bills", count(facts, "bills")),
    line("journal_lines", "journal lines", count(facts, "journal_lines")),
    line("opening_ap", "opening payable items", count(facts, "opening_ap")),
    line("product_vendors", "products that buy from this vendor", count(facts, "product_vendors")),
  ]);
  const removable = lines([
    line("supplier", "this unused vendor", facts.exists ? 1 : 0),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function installerImpact(facts: LifecycleFacts): DeleteImpact {
  const protectedLines = lines([
    line("jobs", "assigned jobs", count(facts, "jobs")),
    line("installer_bills", "labor bills", count(facts, "installer_bills")),
    line("labor", "job labor rows", count(facts, "labor")),
  ]);
  const removable = lines([
    line("installer", "this unused installer crew", facts.exists ? 1 : 0),
  ]);
  return blocked(facts, protectedLines, protectedLines, removable);
}

function paymentImpact(facts: LifecycleFacts): DeleteImpact {
  const blocking = facts.exists
    ? [{ key: "payment", label: "payments are financial history and are voided, not erased", count: 1 }]
    : [];
  const impact = blocked(facts, blocking, blocking, []);
  return { ...impact, canArchive: false, canRestore: false, canDeleteForever: false };
}

export function assessLifecycle(facts: LifecycleFacts): DeleteImpact {
  if (!facts.exists) {
    return {
      recordType: facts.recordType,
      recordId: facts.recordId,
      exists: false,
      archived: false,
      canArchive: false,
      canRestore: false,
      canDeleteForever: false,
      confirmPhrase: confirmPhrase(facts.publicCode),
      blockingReasons: [],
      willDelete: [],
      willDetach: [],
      willPreserve: [],
    };
  }
  switch (facts.recordType) {
    case "customer":
      return customerImpact(facts);
    case "estimate":
      return estimateImpact(facts);
    case "job":
      return jobImpact(facts);
    case "invoice":
      return invoiceImpact(facts);
    case "product":
      return productImpact(facts);
    case "supplier":
      return supplierImpact(facts);
    case "installer":
      return installerImpact(facts);
    case "payment":
      return paymentImpact(facts);
  }
}

export function archiveState(archivedAt: string | null | undefined): "archive" | "already_archived" {
  return archivedAt ? "already_archived" : "archive";
}

export function restoreState(archivedAt: string | null | undefined): "restore" | "already_active" {
  return archivedAt ? "restore" : "already_active";
}

/** Detail stored on the audit row. Counts and codes only. */
export function auditDetail(impact: DeleteImpact): Record<string, number | string> {
  const detail: Record<string, number | string> = {
    record_type: impact.recordType,
  };
  for (const line of [...impact.willDelete, ...impact.willPreserve]) {
    detail[line.key] = line.count;
  }
  return detail;
}

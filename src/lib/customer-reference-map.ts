/**
 * Complete map of schema/app references to customers.id.
 *
 * Used by the owner-approved merge tool and its tests. Identity reassignment
 * only moves LIVE_REASSIGN targets. Immutable snapshots stay on the original
 * customer id so historical documents keep their printed truth.
 *
 * Never auto-merge. Never hard-delete a customer row.
 */

export type CustomerRefDisposition =
  | "live_reassign"
  | "special"
  | "block_if_both"
  | "immutable"
  | "follows_parent";

export type CustomerReference = {
  table: string;
  column: string;
  disposition: CustomerRefDisposition;
  notes: string;
};

/** Every live FK / column that the merge RPC must re-point duplicate → survivor. */
export const LIVE_CUSTOMER_REASSIGN: CustomerReference[] = [
  { table: "jobs", column: "customer_id", disposition: "live_reassign", notes: "Install + cash-and-carry jobs" },
  { table: "estimates", column: "customer_id", disposition: "live_reassign", notes: "Quotes" },
  { table: "invoices", column: "customer_id", disposition: "live_reassign", notes: "Identity only; totals unchanged" },
  { table: "customer_deposits", column: "customer_id", disposition: "live_reassign", notes: "Keep job_id/estimate_id restrictions" },
  { table: "credit_memos", column: "customer_id", disposition: "live_reassign", notes: "Do not re-apply" },
  { table: "refunds", column: "customer_id", disposition: "live_reassign", notes: "Do not recreate refunds" },
  { table: "orders", column: "customer_id", disposition: "live_reassign", notes: "Customer orders / pickups" },
  { table: "appointments", column: "customer_id", disposition: "live_reassign", notes: "Estimate/install appointments" },
  { table: "activities", column: "customer_id", disposition: "live_reassign", notes: "Notes / call log" },
  { table: "messages", column: "customer_id", disposition: "live_reassign", notes: "Email/SMS records" },
  { table: "documents", column: "customer_id", disposition: "live_reassign", notes: "DB linkage only; storage path unchanged" },
  { table: "office_tasks", column: "customer_id", disposition: "live_reassign", notes: "Office tasks" },
  { table: "service_callbacks", column: "customer_id", disposition: "live_reassign", notes: "Service / warranty callbacks" },
  { table: "service_addresses", column: "customer_id", disposition: "live_reassign", notes: "Property addresses" },
  { table: "sample_checkouts", column: "customer_id", disposition: "live_reassign", notes: "Samples" },
  { table: "customer_areas", column: "customer_id", disposition: "live_reassign", notes: "Room measurements" },
  { table: "purchase_orders", column: "customer_id", disposition: "live_reassign", notes: "PO header customer" },
  { table: "po_items", column: "for_customer_id", disposition: "live_reassign", notes: "Attributed PO lines" },
  { table: "bills", column: "customer_id", disposition: "live_reassign", notes: "Vendor bills tagged to a customer" },
  { table: "stock_movements", column: "customer_id", disposition: "live_reassign", notes: "Inventory pulls" },
  { table: "opening_ar_items", column: "customer_id", disposition: "live_reassign", notes: "Opening AR wizard rows" },
  { table: "step_overrides", column: "customer_id", disposition: "special", notes: "Drop colliding account-level keys, then move" },
  { table: "profiles", column: "customer_id", disposition: "special", notes: "Portal identity; block if both have portal users" },
  { table: "estimate_drafts", column: "customer_id", disposition: "block_if_both", notes: "PK = customer_id; block if both have drafts" },
  { table: "customers", column: "referred_by_customer_id", disposition: "special", notes: "Point at survivor; null if self-ref" },
];

/** Child money rows follow invoice/job — no direct customer_id rewrite. */
export const FOLLOWS_PARENT: CustomerReference[] = [
  { table: "payments", column: "invoice_id", disposition: "follows_parent", notes: "Follows invoice.customer_id" },
  { table: "credit_applications", column: "invoice_id", disposition: "follows_parent", notes: "Follows credit_memo + invoice" },
  { table: "invoice_write_offs", column: "invoice_id", disposition: "follows_parent", notes: "Follows invoice" },
  { table: "customer_deposit_applications", column: "invoice_id", disposition: "follows_parent", notes: "Follows deposit + invoice" },
  { table: "invoice_items", column: "invoice_id", disposition: "follows_parent", notes: "Follows invoice" },
  { table: "job_satisfaction", column: "job_id", disposition: "follows_parent", notes: "Follows jobs" },
  { table: "installer_bills", column: "job_id", disposition: "follows_parent", notes: "No customer_id; follows job" },
];

/** Historical truth — do not rewrite as part of identity merge. */
export const IMMUTABLE_CUSTOMER_REFS: CustomerReference[] = [
  {
    table: "estimate_approval_snapshots",
    column: "approved_by_customer_id",
    disposition: "immutable",
    notes: "Approval snapshot identity at the time of approval",
  },
  {
    table: "journal_lines",
    column: "customer_id",
    disposition: "immutable",
    notes: "Posted GL; merge is not a financial posting",
  },
  {
    table: "accounting_posting_outbox",
    column: "payload",
    disposition: "immutable",
    notes: "Outbox payloads keep historical customer id",
  },
  {
    table: "customer_duplicate_overrides",
    column: "created_customer_id",
    disposition: "immutable",
    notes: "Create-anyway audit (0160), not pair suppression",
  },
];

export const ALL_CUSTOMER_REFERENCES: CustomerReference[] = [
  ...LIVE_CUSTOMER_REASSIGN,
  ...FOLLOWS_PARENT,
  ...IMMUTABLE_CUSTOMER_REFS,
];

export const MERGE_SQL_TABLES = LIVE_CUSTOMER_REASSIGN.filter(
  (r) => r.disposition === "live_reassign",
).map((r) => r.table);

export const MERGE_BLOCK_TABLES = ["profiles", "estimate_drafts"] as const;

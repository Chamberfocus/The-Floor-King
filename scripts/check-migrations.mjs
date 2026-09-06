#!/usr/bin/env node
/**
 * Static migration intent check — NO database connection.
 *
 * Proves required Step 3–6 estimate-architecture migration FILES exist in the
 * repo, have unique numeric prefixes, and contain expected SQL markers.
 * Does NOT prove production has applied them.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "supabase", "migrations");

/** Required files for estimate Steps 3–6 (actual repo filenames). */
const REQUIRED_FILES = [
  "0152_job_line_items.sql",
  "0154_po_item_job_line.sql",
  "0155_estimate_approval_snapshots.sql",
  "0156_jobs_estimate_id_unique.sql",
  "0157_invoice_approval_snapshot.sql",
  "0158_f0_payment_void_schedule_override.sql",
  "0159_f1_credits_refunds.sql",
  "0160_f2_operations_glue.sql",
  "0161_f3_chart_periods_settings.sql",
  "0162_f3_journal_engine.sql",
  "0163_f4_integration_mappings_outbox.sql",
  "0164_f4_bank_reconciliation.sql",
  "0165_f5_invoice_credit_refund_void.sql",
  "0166_f5_ap_expense_bill_payment.sql",
  "0167_f5_deposits_recon.sql",
  "0168_f5_anon_rpc_security.sql",
  "0169_f6_p0_money_security_integrity.sql",
  "0170_f6_p1_books_readiness.sql",
  "0171_f6_p2a_audit_retrofit.sql",
  "0172_f6_p2b_opening_balance_wizard.sql",
  "0173_f6_p2c_bank_reconciliation.sql",
  "0174_f6_p3a_installer_labor_accounting.sql",
  "0175_f6_p3b_ap_vendor_integrity.sql",
  "0176_f6_p4_inventory_accounting.sql",
  "0177_f6_p5_financial_reporting_control_center.sql",
  "0178_f7_launch_integrity_hardening.sql",
  "0179_final_pre_live_readiness.sql",
];

/**
 * Markers that must appear in the named file (substring match, case-sensitive
 * as written in SQL).
 */
const REQUIRED_MARKERS = [
  {
    file: "0152_job_line_items.sql",
    markers: ["job_line_items", "create table if not exists public.job_line_items"],
  },
  {
    file: "0154_po_item_job_line.sql",
    markers: ["job_line_id", "po_items"],
  },
  {
    file: "0155_estimate_approval_snapshots.sql",
    markers: [
      "estimate_approval_snapshots",
      "apply_estimate_option_lines",
      "approval_stale",
      "approved_at",
    ],
  },
  {
    file: "0156_jobs_estimate_id_unique.sql",
    markers: ["jobs_estimate_id_unique", "estimate_id"],
  },
  {
    file: "0157_invoice_approval_snapshot.sql",
    markers: [
      "approval_snapshot_id",
      "commercial_kind",
      "estimate_approval_snapshots",
    ],
  },
  {
    file: "0158_f0_payment_void_schedule_override.sql",
    markers: [
      "record_invoice_payment_safe",
      "job_schedule_overrides",
      "idempotency_key",
    ],
  },
  {
    file: "0159_f1_credits_refunds.sql",
    markers: [
      "credit_memos",
      "credit_applications",
      "apply_credit_to_invoice_safe",
      "record_refund_safe",
    ],
  },
  {
    file: "0160_f2_operations_glue.sql",
    markers: [
      "office_tasks",
      "job_operational_holds",
      "service_callbacks",
      "customer_duplicate_overrides",
    ],
  },
  {
    file: "0161_f3_chart_periods_settings.sql",
    markers: [
      "gl_accounts",
      "accounting_periods",
      "accounting_settings",
      "accounting_account_mappings",
    ],
  },
  {
    file: "0162_f3_journal_engine.sql",
    markers: [
      "journal_entries",
      "journal_lines",
      "post_journal_entry_safe",
      "accounting_posting_outbox",
    ],
  },
  {
    file: "0163_f4_integration_mappings_outbox.sql",
    markers: [
      "accounting_payment_method_mappings",
      "customer_deposits",
      "accounting_event_status",
      "accounting_expense_category_mappings",
      "enqueue_accounting_outbox_safe",
      "claim_accounting_outbox_item",
      "void_invoice_payment_safe",
      "ACCOUNTING_INVALID_ECONOMIC_DATE",
      "revoke all on function public.enqueue_accounting_outbox_safe from authenticated",
    ],
  },
  {
    file: "0164_f4_bank_reconciliation.sql",
    markers: [
      "bank_reconciliation_sessions",
      "bank_reconciliation_cleared_lines",
    ],
  },
  {
    file: "0165_f5_invoice_credit_refund_void.sql",
    markers: [
      "finalize_invoice_safe",
      "void_invoice_safe",
      "void_refund_safe",
      "issue_credit_memo_safe",
      "void_credit_memo_safe",
      "accounting_require_roles",
      "invoices_enforce_issue_via_finalize",
    ],
  },
  {
    file: "0166_f5_ap_expense_bill_payment.sql",
    markers: [
      "post_vendor_bill_safe",
      "record_bill_payment_safe",
      "void_bill_payment_safe",
      "record_direct_expense_safe",
      "expenses_idempotency_key_uidx",
      "accounting_require_roles",
    ],
  },
  {
    file: "0167_f5_deposits_recon.sql",
    markers: [
      "customer_deposit_applications",
      "record_customer_deposit_safe",
      "apply_customer_deposit_safe",
      "complete_bank_reconciliation_safe",
      "accounting_require_roles",
    ],
  },
  {
    file: "0168_f5_anon_rpc_security.sql",
    markers: [
      "accounting_is_service_role",
      "accounting_request_jwt_role",
      "revoke all on function",
      "from anon",
      "allow_invoice_issue_guard",
      "enqueue_accounting_outbox_safe",
      "Untrusted request identity",
    ],
  },
  {
    file: "0169_f6_p0_money_security_integrity.sql",
    markers: [
      "invoice_applied_credits",
      "invoice_commercial_total",
      "IDEMPOTENCY_CROSS_INVOICE",
      "Post-lock idempotency recheck",
      "v_credited",
      "record invoice payments",
      "claim_accounting_outbox_item is service_role only",
      "accounting_actor_id",
      "Use record_customer_deposit_safe for pre-invoice",
      "revoke all on function %s from anon",
    ],
  },
  {
    file: "0170_f6_p1_books_readiness.sql",
    markers: [
      "write_off_invoice_safe",
      "financial_audit_log",
      "stage_bank_statement_import_safe",
      "bad_debt_expense",
      "invoice_applied_write_offs",
      "confirm_backup_pitr_safe",
      "Post-lock idempotency recheck",
      "IDEMPOTENCY_CROSS_INVOICE",
      "financial_audit_log_immutable",
      "revoke insert, update, delete on public.bank_statement_import_batches from authenticated",
      "duplicate_status",
      "source_row_fingerprint",
      "exact_reimport_of_line_id",
      "canonical_source_row_fingerprint",
      "jsonb_array_elements(p_rows) with ordinality",
      "p_attestation_evidence",
      "MISSING_ACCOUNT_MAPPING",
      "log_financial_audit_safe is internal-only",
    ],
  },
  {
    file: "0171_f6_p2a_audit_retrofit.sql",
    markers: [
      "accounting_audit_from_definer_safe",
      "invoice_payment_recorded",
      "credit_applied",
      "refund_recorded",
      "customer_deposit_recorded",
      "audit:payment:",
      "audit:credit_apply:",
      "audit:journal:",
      "revoke all on function public.accounting_audit_from_definer_safe",
      "log_financial_audit_safe",
      "invoice_open_ar_balance",
      "invoice_applied_deposits",
      "IDEMPOTENCY_CROSS_ENTITY",
      "v_remaining := public.invoice_open_ar_balance(p_invoice_id)",
      "v_open := public.invoice_open_ar_balance(p_invoice_id)",
      "void_credit_application_safe",
      "void_customer_deposit_application_safe",
      "void_invoice_write_off_safe",
      "active_credit_applications",
      "active_deposit_applications",
      "active_write_offs",
      "credit_application_void",
      "deposit_apply_void",
      "invoice_write_off_void",
    ],
  },
  {
    file: "0172_f6_p2b_opening_balance_wizard.sql",
    markers: [
      "opening_balance_batches",
      "opening_balance_lines",
      "opening_ar_items",
      "opening_ap_items",
      "create_opening_balance_batch_safe",
      "save_opening_balance_draft_safe",
      "validate_opening_balance_batch_safe",
      "finalize_opening_balances_safe",
      "void_opening_balance_batch_safe",
      "opening_balance_compute_package",
      "opening_balance_validate_draft_payload",
      "post_opening_balance_journal_from_definer_safe",
      "app.trusted_opening_balance_post",
      "OPENING_BALANCE_TRUST_REQUIRED",
      "OPENING_BALANCE_SOURCE_MISMATCH",
      "post_opening_balance_journal_from_definer_safe(",
      "Opening balances do not balance.",
      "NEVER silently plug",
      "Validate opening balances before finalizing",
      "as-of date cannot be after",
      "opening_balances_entered = true",
      "opening_balance_batch_created",
      "opening_balance_validated",
      "opening_balance_posted",
      "opening_balance_reversed",
      "journal_entry_posted",
      "PHASE A",
      "accounting_actor_id",
      "set search_path = public",
      "revoke insert, update, delete on public.opening_balance_batches from authenticated",
      "revoke all on function %s from anon",
      "BOOKS_OF_RECORD",
      "post_journal_entry_safe",
      "opening_balance:batch:",
    ],
  },
  {
    file: "0173_f6_p2c_bank_reconciliation.sql",
    markers: [
      "bank_reconciliation_matches",
      "bank_reconciliation_compute_package",
      "create_bank_reconciliation_safe",
      "attach_bank_import_to_reconciliation_safe",
      "create_bank_match_safe",
      "remove_bank_match_safe",
      "resolve_bank_import_duplicate_safe",
      "finalize_bank_reconciliation_safe",
      "void_bank_reconciliation_safe",
      "accounting_is_eligible_cash_account",
      "invalid_text_representation",
      "occurrence_index",
      "bank_recon_session_is_successfully_finalized",
      "statement_equation_difference",
      "book_vs_adjusted_difference",
      "unresolved_rejected",
      "p_confirm",
      "pg_advisory_xact_lock",
      "bank_import_line_excluded",
      "bank_import_attached",
      "bank_recon_effective_journal_allocated",
      "bank_recon_session_was_finalized",
      "new.prior_status is not distinct from old.status",
      "accounting_audit_from_definer_safe",
      "Idempotency key already used",
      "bank_statement_imported",
      "bank_reconciliation_created",
      "bank_reconciliation_finalized",
      "bank_reconciliation_voided",
      "bank_match_created",
      "revoke insert, update on public.bank_reconciliation_sessions from authenticated",
      "books_of_record",
      "drop function if exists public.complete_bank_reconciliation_safe(uuid, uuid)",
      "complete_bank_reconciliation_safe(uuid, uuid, boolean)",
    ],
  },
  {
    file: "0174_f6_p3a_installer_labor_accounting.sql",
    markers: [
      "approve_installer_labor_safe",
      "reverse_installer_labor_safe",
      "correct_installer_labor_safe",
      "create_installer_labor_bill_safe",
      "installer_labor_active_actual_total",
      "installer_labor_lock_job",
      "worker_kind",
      "ap_bill_id",
      "installer_labor_bill_id",
      "accounting_audit_from_definer_safe",
      "installer_bill_void",
      "revoke insert, update, delete on public.installer_bills from authenticated",
      "pg_advisory_xact_lock",
      "legacy_non_canonical",
      "installer_labor_void_linked_ap",
      "installer_labor_validate_lines",
      "CLASSIFICATION_REQUIRED",
      "SUBCONTRACTOR_USE_AP_PAYMENT",
      "installer_labor_lock_for_bill",
      "INSTALLER_LABOR_CORRECTION_ABORTED",
      "installer_labor_record_vendor_event",
      "Resolve ACTUAL persisted worker identity",
    ],
  },
  {
    file: "0175_f6_p3b_ap_vendor_integrity.sql",
    markers: [
      "create_vendor_bill_safe",
      "save_vendor_bill_draft_safe",
      "activate_vendor_bill_safe",
      "void_vendor_bill_safe",
      "correct_vendor_bill_safe",
      "ap_bill_original_total",
      "ap_bill_remaining",
      "ap_lookup_action",
      "IDEMPOTENCY_CONFLICT",
      "AP_CORRECTION_ABORTED",
      "app.ap_mutation",
      "revoke insert, update, delete on public.bills from authenticated",
      "source_type",
      "ap_record_vendor_event",
      "installer_labor_record_vendor_event",
      "pg_advisory_xact_lock",
      "bills_enforce_ap_immutability",
      "bill_payments_enforce_ap_immutability",
      "ap_lock_vendor_invoice",
      "create trigger bill_payments_block_void_ap",
      "AP_EXPENSE_BOUNDARY",
      "REQUIRE_DIRECT_EXPENSE_ACK",
      "DIRECT_EXPENSE_EXISTS",
      "ap_lock_vendor_invoices_sorted",
      "ap_lock_jobs_sorted",
      "ap_reject_if_direct_expense_identity",
      "revoke insert, update, delete on public.expenses from authenticated",
      "record_direct_expense",
      "cash_account_id",
      "never bill_id-only shortcut",
      "LEGACY RPC CLOSURE — post_vendor_bill_safe",
      "AP_LEGACY_RPC: post_vendor_bill_safe must be dropped",
      "1b) Expenses provenance columns",
      "expenses_admin_office_select",
      "AP_LOCK_RETRY",
      "bills_admin_office_select",
    ],
  },
  {
    file: "0176_f6_p4_inventory_accounting.sql",
    markers: [
      "receive_inventory_safe",
      "consume_inventory_safe",
      "reserve_inventory_safe",
      "release_inventory_safe",
      "adjust_inventory_safe",
      "return_inventory_from_job_safe",
      "return_inventory_to_vendor_safe",
      "reverse_inventory_movement_safe",
      "inv_flag_receipt_ap_variance_safe",
      "inv_lock_product",
      "inv_begin_action",
      "inv_lock_idempotency",
      "inv_job_net_returnable_qty",
      "inv_plan_job_return_allocations",
      "inventory_return_allocations",
      "inventory_carrying_value",
      "inv_apply_value_effect",
      "INV_OVER_RECEIVE",
      "INV_RELEASE_EXCEEDS_JOB_RESERVED",
      "INV_ROLL_REQUIRED",
      "INV_NEGATIVE_STOCK",
      "IDEMPOTENCY_CONFLICT",
      "app.inventory_mutation",
      "products_protect_inventory_fields",
      "stock_movements_ops",
      "inv_list_movements_ops",
      "revoke insert, update, delete on public.stock_movements from authenticated",
      "revoke select on public.stock_movements from authenticated",
      "on delete restrict",
      "avg_unit_cost",
      "legacy_review_required",
      "pg_advisory_xact_lock",
      "stock_movements_enforce_immutability",
      "inventory_receipt",
      "inventory_consumption",
      "FINAL GLOBAL LOCK ORDER",
      "fifo_historical_pull",
      "INV_LOCK_RETRY",
      "INV_COST_OVERRIDE_FORBIDDEN",
      "Operational response: no unit_cost",
      "Operational response only — never return carrying_value",
      "INV_NEGATIVE_VALUE: inventory valuation integrity check failed",
      "inv_authorize_unit_cost_override",
      "Canonical PO line cost is SoT",
      "canonical product lock, then stock_kind",
      "v_delta := round(v_counted - coalesce(v_on",
      "INV_ROLL_ADJUST_REQUIRES_ROLL_WORKFLOW",
      "INV_REVERSAL_UNSAFE",
      "p_create_roll",
      "adjust_roll_inventory_safe",
      "revoke select on table public.products from authenticated",
      "inv_get_product_catalog_costs",
      "inv_finalize_rolled_valuation",
      "PHYSICAL quantity synchronization ONLY",
      "revoke select (avg_unit_cost, inventory_carrying_value) on public.products from authenticated",
      "products_inventory_ops",
      "inv_list_inventory_products_ops",
      "inv_get_product_valuation",
      "UNLOCKED discovery",
    ],
  },
  {
    file: "0177_f6_p5_financial_reporting_control_center.sql",
    markers: [
      "acct_report_trial_balance",
      "acct_report_pnl",
      "acct_report_balance_sheet",
      "acct_report_general_ledger",
      "acct_report_ar_aging",
      "acct_report_ap_aging",
      "acct_period_close_safe",
      "acct_period_reopen_safe",
      "acct_exceptions_scan",
      "acct_cutover_readiness_snapshot",
      "accounting_control_idempotency",
      "acct_report_require_finance",
      "Posting stays OFF",
      "Do NOT set posting_enabled",
      "set search_path = public",
      "accounting_actor_id",
      "IDEMPOTENCY_CONFLICT: key reused with different control context.",
      "revoke all on function %s from authenticated",
      "revoke all on public.accounting_control_idempotency from public, anon, authenticated",
      "Warehouse and crew fail role check",
      "PITR expected NOT CONFIRMED → NOT_READY",
      "External books remain official",
      "HISTORICAL_COMMERCIAL_UNSUPPORTED",
      "beginning_balance",
      "unclosed_earnings",
      "GL_ACCOUNT_SUBTYPE_LOCKED",
      "performance', 'set_based'",
      "Do NOT filter on is_active",
      "accounting_periods_daterange_excl",
      "acct_lock_period_for_posting",
      "btree_gist",
      "enqueue_accounting_outbox_safe",
      "OUTBOX_EVENT_DATE_UNRESOLVED",
      "acct_parse_outbox_economic_date",
      "Pending accounting events exist for this period.",
    ],
  },
  {
    file: "0178_f7_launch_integrity_hardening.sql",
    markers: [
      "jobs_installer_schedule_excl",
      "jobs_crew_schedule_excl",
      "schedule_job_install_safe",
      "pg_advisory_xact_lock(180",
      "181,",
      "estimate_approval_lock_idempotency",
      "record_estimate_approval_safe",
      "build_estimate_approval_payload_live",
      "estimate_approval_idempotency",
      "my_customer_id",
      "APPROVAL_PORTAL_SERVICE_ROLE",
      "APPROVAL_ACTOR_SPOOF",
      "IDEMPOTENCY_CONFLICT",
      "SCHEDULE_INVALID_RANGE",
      "JOB_SCHEDULE_VIA_RPC",
      "office_tasks_protect_columns",
      "TASK_FIELD_FORBIDDEN",
      "revoke delete on public.office_tasks",
      "log_financial_audit_safe",
      "estimate_approved",
      "office_tasks_select",
      "office_tasks_insert",
      "office_tasks_update",
      "F7_0178_PRECHECK",
      "set search_path = public",
      "Do NOT set posting_enabled",
      "exclusion_violation",
      "APPROVAL_STALE_OR_CONFLICT",
      "v_manager := v_role in ('admin', 'office', 'sales_manager')",
      "Could not build the approval snapshot from the current estimate. Contact the office.",
      "raise warning 'APPROVAL_PAYLOAD_BUILD internal:",
      "revoke all on function public.schedule_job_install_safe",
      "revoke all on function public.record_estimate_approval_safe",
    ],
  },
  {
    file: "0179_final_pre_live_readiness.sql",
    markers: [
      "estimates_protect_portal_columns",
      "PORTAL_ESTIMATE_FORBIDDEN",
      "F7_0179_PRECHECK",
      "Do NOT set posting_enabled",
      "set search_path = public",
      "js_read",
      "documents_storage_rw",
      "F7_0179_POSTCHECK",
      "app.allow_portal_approval_mutation",
      "changes_requested' and new.status = 'declined'",
    ],
  },
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`✓ ${msg}`);
}

if (!existsSync(DIR)) {
  fail(`Migrations directory missing: ${DIR}`);
  process.exit(1);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
console.log(`Static migration check (${files.length} SQL files in supabase/migrations)\n`);

// Unique numeric prefixes (NNNN_*.sql)
const prefixOf = (f) => {
  const m = f.match(/^(\d{4})_/);
  return m ? m[1] : null;
};
const byPrefix = new Map();
for (const f of files) {
  const p = prefixOf(f);
  if (!p) {
    fail(`Migration filename missing NNNN_ prefix: ${f}`);
    continue;
  }
  const list = byPrefix.get(p) ?? [];
  list.push(f);
  byPrefix.set(p, list);
}
for (const [p, list] of byPrefix) {
  if (list.length > 1) {
    fail(`Duplicate migration prefix ${p}: ${list.join(", ")}`);
  }
}
if ((process.exitCode ?? 0) === 0) {
  ok("All migration numeric prefixes are unique");
}

// Ordering: sorted filenames should be non-decreasing by prefix
const prefixes = files.map(prefixOf).filter(Boolean);
for (let i = 1; i < prefixes.length; i++) {
  if (prefixes[i] < prefixes[i - 1]) {
    fail(
      `Migration order invalid: ${files[i]} (prefix ${prefixes[i]}) sorts after ${files[i - 1]} but prefix goes backwards`,
    );
  }
}
if ((process.exitCode ?? 0) === 0) {
  ok("Migration filename order is valid (non-decreasing prefixes)");
}

// Required files
for (const name of REQUIRED_FILES) {
  const path = join(DIR, name);
  if (!existsSync(path)) {
    fail(`Required migration file missing: supabase/migrations/${name}`);
  } else {
    ok(`Required file present: ${name}`);
  }
}

// Markers
for (const { file, markers } of REQUIRED_MARKERS) {
  const path = join(DIR, file);
  if (!existsSync(path)) continue;
  const body = readFileSync(path, "utf8");
  for (const marker of markers) {
    if (!body.includes(marker)) {
      fail(`Missing SQL marker "${marker}" in supabase/migrations/${file}`);
    } else {
      ok(`${file} contains "${marker}"`);
    }
  }
}

if ((process.exitCode ?? 0) !== 0) {
  console.error("\nStatic migration check FAILED (repository schema intent).");
  process.exit(1);
}
console.log("\n✓ Static migration check passed (repository intent only — not production apply).");

# F6-P2C Bank Reconciliation — 0173 Final Deployment-Blocker Results

**0173 FINAL DEPLOYMENT-BLOCKER REVIEW COMPLETE:** YES  
**0173 APPLIED:** NO

| Gate | Result |
|------|--------|
| HISTORICAL CLEARING | PASS |
| MULTI-PERIOD OUTSTANDING ITEMS | PASS |
| VOIDED-MATCH CAPACITY | PASS |
| FINALIZED SESSION IMMUTABILITY | PASS |
| FINALIZED CHILD IMMUTABILITY | PASS |
| CREATE IDEMPOTENCY CONTEXT | PASS |
| MATCH IDEMPOTENCY CONTEXT | PASS |
| CONFIRMATION BYPASS | BLOCKED |
| IMPORT BATCH REUSE SAFETY | PASS |
| IMPORT BATCH STATUS SAFETY | PASS |
| LOCK ORDER | PASS |
| FUTURE JOURNAL MATCH | BLOCKED |
| OUT-OF-PERIOD ACCEPTANCE | BLOCKED |
| FINAL SNAPSHOT MATCH PROOF | PASS |
| EXACT REIMPORT CANONICAL LINK | PASS |
| NON-OBJECT ROW IMPORT | PASS |
| SPECIAL NUMERIC VALUES | BLOCKED |
| FRACTIONAL CENT SAFETY | PASS |
| DIRECTION/SIGN SAFETY | PASS |
| AUDIT EVENT SEMANTICS | PASS |
| MATCH REMOVAL REASON | PASS |
| ACL EXACT OVERLOAD REVIEW | PASS |
| RLS/DML REVIEW | PASS |
| POSTING-OFF BYPASS | BLOCKED |

**ACCOUNTING FLAGS CHANGED:** NO  
**BACKUP/PITR CONFIRMED:** NO  
**PRODUCTION BUSINESS DATA MUTATED:** NO  

**npm run verify:** PASS  
**TOTAL TESTS:** 557

---

## Summary

This pass fixes the remaining deployment blockers in the existing `0173_f6_p2c_bank_reconciliation.sql` migration without redesigning the module. The largest fix is **cross-reconciliation historical clearing**: prior reconciled/completed allocations now permanently reduce outstanding journal/import capacity; void/cancelled parent sessions preserve match evidence but release capacity for replacement reconciliations.

---

## Effective clearing allocation definition

An allocation counts toward clearing/capacity when **all** of:

1. `bank_reconciliation_matches.status = 'active'`
2. Parent session is **not** terminal (`void`, `cancelled`)
3. Parent session is either:
   - **Successfully finalized** (`reconciled`, `completed`), or
   - The **current editable session** (`draft`, `in_progress`, `open`)

Void/cancelled sessions keep match rows as historical evidence but **do not** reserve bank-line or journal-line capacity.

Internal helpers:

- `bank_recon_match_parent_effective(status)`
- `bank_recon_effective_journal_allocated(journal_line_id, current_session_id)`
- `bank_recon_effective_import_allocated(import_line_id, current_session_id)`

---

## Historical clearing algorithm

For each posted bank journal line through `statement_end`:

```
remaining = bank_impact
          - effective_prior_finalized_allocations
          - current_session_allocations
```

Outstanding book debit/credit sums use `remaining > 0.005`. Bank-line remaining amounts use the same effective-import rule. `bank_reconciliation_compute_package` and `create_bank_match_safe` both use these helpers (no session-only subtraction).

---

## Void/replacement allocation behavior

1. Session A finalizes → allocations count as effective clearing.
2. Session A voided (while `books_of_record = false`) → match rows and `final_snapshot` preserved; allocations **stop** counting.
3. Session B created for same period → can allocate the same journal/import lines without deleting Session A evidence.

---

## Lock order (all mutation RPCs)

1. Derive account/batch/session identifiers without locking
2. `bank_recon_lock_account` (advisory xact lock)
3. `bank_reconciliation_sessions` `FOR UPDATE`
4. `bank_statement_import_lines` `FOR UPDATE`
5. `journal_lines` `FOR UPDATE`
6. Match row `FOR UPDATE` when needed

Review/exclusion/duplicate resolution now lock session before import line (was reversed).

---

## Batch reuse policy

`attach_bank_import_to_reconciliation_safe`:

- Accepts batch statuses: `staged`, `reviewed`, `matched` only
- Rejects `cancelled` batches
- Blocks attachment when batch is already linked to another **editable** or **successfully finalized** session
- Terminal void/cancelled prior sessions do not block reuse
- Account advisory lock prevents attach races

---

## Idempotency context policy

**Create session:** same key requires matching `account_id`, `statement_start`, `statement_end`, `opening_balance`, `ending_balance`; else `Idempotency key already used with a different reconciliation context.`

**Create match:** same key requires matching session, import line, journal line, and `allocated_amount`; else conflict.

---

## Final snapshot contents

`final_snapshot` includes the compute package plus:

- `match_summary[]`: `{ match_id, import_line_id, journal_line_id, allocated_amount, bank_direction }` ordered by `match_id`
- `match_allocation_digest`: MD5 of ordered match summary
- `import_evidence`: canonical included count, excluded count, rejected count, possible-duplicate resolved count, exact-reimport evidence count
- Finalization metadata (`finalized_at`, `finalized_by`, balances, dates, batch)

---

## Numeric import policy

- `bank_import_try_numeric` rejects NaN, ±Infinity, `inf`, fractional cents (>2 dp), and values outside `numeric(12,2)`
- Explicit `direction` + negative `amount` → rejected (no silent abs)
- Without direction, sign determines deposit/withdrawal then abs magnitude
- Non-object JSON array elements: fingerprinted as invalid, rejected per-row without aborting batch

---

## Finalization confirmation path

- Canonical: `finalize_bank_reconciliation_safe(p_session_id, p_actor, p_confirm)` — requires `p_confirm = true`
- Legacy: `complete_bank_reconciliation_safe(p_session_id, p_completed_by, p_confirm)` — passes `p_confirm` through; **does not** auto-confirm
- Obsolete 2-arg `complete_bank_reconciliation_safe(uuid, uuid)` **dropped and revoked**

---

## Final RPC signatures (staff — authenticated + service_role)

| RPC | Signature |
|-----|-----------|
| `stage_bank_statement_import_safe` | `(uuid, text, jsonb, uuid)` |
| `create_bank_reconciliation_safe` | `(uuid, date, date, numeric, numeric, text, uuid, text)` |
| `attach_bank_import_to_reconciliation_safe` | `(uuid, uuid, uuid)` |
| `create_bank_match_safe` | `(uuid, uuid, uuid, numeric, uuid, text)` |
| `remove_bank_match_safe` | `(uuid, text, uuid)` |
| `resolve_bank_import_duplicate_safe` | `(uuid, text, text, uuid)` |
| `exclude_bank_import_line_safe` | `(uuid, text, uuid)` |
| `finalize_bank_reconciliation_safe` | `(uuid, uuid, boolean)` |
| `void_bank_reconciliation_safe` | `(uuid, text, uuid)` |
| `complete_bank_reconciliation_safe` | `(uuid, uuid, boolean)` |

Status helpers (`bank_recon_session_is_*`, `bank_import_line_included_in_statement`) remain staff-readable.

---

## Obsolete overloads removed/revoked

- `finalize_bank_reconciliation_safe(uuid, uuid)` — dropped
- `complete_bank_reconciliation_safe(uuid, uuid)` — dropped + explicit revoke (no authenticated execute)

---

## New triggers / immutability guards

| Trigger | Protects |
|---------|----------|
| `bank_recon_sessions_finalized_immutable` | Sessions with `completed_at` or `final_snapshot` (survives void) |
| `bank_recon_matches_protected_immutable` | Match rows on finalized-history sessions |
| `bank_recon_cleared_protected_immutable` | Cleared-line rows on finalized-history sessions |
| `bank_import_lines_protected_immutable` | Import lines on batches linked to finalized-history sessions |

Controlled void transition (`reconciled/completed → void` with reason) remains allowed once.

---

## Database objects changed (0173)

**Tables/columns:** unchanged from prior 0173 revision (sessions extensions, import line review columns, `bank_reconciliation_matches`).

**New/changed functions:**

- `bank_recon_session_was_finalized`
- `bank_recon_match_parent_effective`
- `bank_recon_effective_journal_allocated`
- `bank_recon_effective_import_allocated`
- `bank_recon_batch_has_protected_session`
- `bank_import_fingerprint_line`
- `prevent_protected_bank_recon_match_mutation`
- `prevent_protected_bank_recon_cleared_mutation`
- `prevent_protected_bank_import_line_mutation`
- Revised: `bank_import_try_numeric`, `prevent_finalized_bank_recon_mutation`, `bank_reconciliation_compute_package`, all staff RPCs, `complete_bank_reconciliation_safe`

---

## Files changed

| File | Change |
|------|--------|
| `supabase/migrations/0173_f6_p2c_bank_reconciliation.sql` | Deployment-blocker fixes (~2938 lines) |
| `src/lib/accounting/bank-reconciliation.ts` | Effective-match helpers, cross-session package math |
| `src/lib/accounting/bank-import.ts` | Fractional-cent + direction/sign validation |
| `src/lib/data/bank-reconciliation.ts` | Cross-session matches for outstanding calc |
| `tests/golden/f6-p2c-bank-reconciliation.test.ts` | +8 deployment-blocker tests |
| `scripts/check-migrations.mjs` | 0173 markers |
| `scripts/verify-f6-p0-production.mjs` | 3-arg complete/finalize probes |

---

## Remaining known limitations

1. **No live DB integration tests** — golden tests mirror SQL/TS semantics; owner must apply 0173 and run read-only verifier.
2. **Opening-balance continuity** warns on mismatch; only blocks absurd gaps (> $1M).
3. **No CSV UI for malformed scalar JSON** — server rejects; client CSV path always sends objects.
4. **Journal immutability after match** — assumes posted journals are not edited; reversals are separate lines.
5. **Replacement after void** requires manual new session creation; no auto-rewire of import batch.
6. **Accounting posting remains OFF** — reconciliation is evidence-only; no journal creation from this module.

---

## OWNER ACTION

**DO NOT APPLY without review.** Full SQL is in `supabase/migrations/0173_f6_p2c_bank_reconciliation.sql` (also copied to clipboard).

Apply in Supabase SQL Editor when approved. Re-run `scripts/verify-f6-p0-production.mjs` read-only against production after apply.

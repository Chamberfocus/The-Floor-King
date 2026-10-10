# CRM launch RC1 integration

Branch `cursor/crm-launch-rc1` starts at `main` `7e479384` and merges PRs #65–#71 in that order. Nothing here is merged to `main`, deployed, or applied to a database.

## Included repairs

| PR | Tip commit | Repair |
| --- | --- | --- |
| #65 | `c3c93935` | Lost and Parked workflow outcomes (`0487`) |
| #66 | `86e3273d` | Daily cron and Resend webhook fail closed |
| #67 | `8341d64f` | Order delete keeps posted invoices and payments (`0488`) |
| #68 | `6d1d3cd8` | Payment void stays on `void_invoice_payment_safe` |
| #69 | `bcd19dc6` | Job cancel releases reservations in one transaction (`0489`) |
| #70 | `96d53dfc` | Job, estimate, and customer delete keep financial history (`0490`) |
| #71 | `79b6822a` | Multi-line purchase-order receiving is one transaction (`0491`) |

Migrations stay in numeric order: `0487`, `0488`, `0489`, `0490`, `0491`. Each function is created in one of those files.

## Conflicts and resolutions

### `package.json` `lint:ci` — #67, #69, #70 against #66

Each pull request appended its own library to the end of the lint command. The integrated line keeps every path: the PR #66 auth files, `src/lib/order-deletion.ts`, `src/lib/job-cancel.ts`, and `src/lib/financial-deletion.ts`.

### `src/app/(app)/invoices/actions.ts` imports — #68 against #67

The void path imports `paymentVoidRpcUnavailable` and `PAYMENT_VOID_RPC_REQUIRED_MESSAGE`. Invoice delete still imports `invoiceHardDeleteBlocker` from `src/lib/order-deletion.ts`. Both function bodies were already combined by the merge.

### `src/lib/workflow-engine.ts` imports — #69 against #65

Lost and Parked still use `stageIsLost` and `stageIsParked` from the outcome column. When Lost settles jobs, the call is `cancelJobWithReservations`, which releases stock and sets `cancelled` in one database transaction. The older separate `releaseJobReservations` plus a direct cancelled update is not used on that path. `selectDeclineStage` and `advanceToLostStage` stay.

`tests/golden/workflow-outcome-b1.test.ts` was updated to expect that combined path. It still requires the outcome check and still rejects a direct cancelled update.

### `src/app/(app)/customers/actions.ts` imports — #70 against #65 and #69

Customer cancel still calls `cancelJobWithReservations` and still reads `outcome`. Customer delete still calls `assertFinancialDeletionAllowed`, then `releaseJobReservations`, then `reservationStillHeld`, then `deleteBareDraftPaperwork`. `reverseReceivedPOs` is not part of customer delete.

`estimates/actions.ts`, `jobs/actions.ts`, `src/lib/po-stock.ts`, and `tests/golden/f7-hardening.test.ts` merged without a conflict marker. The combined files contain both the earlier repair and the later one: outcome-based decline, atomic job cancel, financial deletion gates, atomic PO receiving, and the invoice hard-delete blocker.

### Tests that assumed the repairs were still separate

`tests/golden/workflow-outcome-b1.test.ts` expected Lost settlement to call `releaseJobReservations` and then update the job to cancelled. RC1 keeps the outcome check and uses `cancelJobWithReservations` instead, so a failed release cannot leave the job cancelled.

`tests/golden/financial-deletion.test.ts` expected `src/lib/order-deletion.ts` to be absent, which was true on the PR #70 branch before PR #67 was merged. RC1 keeps both modules. Neither imports the other's blocker, and order delete still consults `orderDestructionBlocker` before it deletes a draft invoice.

## Database readiness

Production project ref: `ayqcaloqsklvskkudvbs`.
Staging project ref named by the owner: `lsrapxmkspocxeeakkcx`.
Those refs are different Supabase projects. This branch does not connect to either one. The earlier 0487 staging note in `docs/0487_STAGING_VALIDATION.md` does not record a project ref, so it is not evidence that `lsrapxmkspocxeeakkcx` already has 0487 or the rest of the schema.

The repo has 488 migration files, from `0001_init.sql` through `0491_atomic_po_receive.sql`. An empty database has none of the tables or functions those later files call. `0487`–`0491` are the last five files, not a standalone schema.

Apply order on a proven staging project, after a human confirms the dashboard ref:

1. Inventory the schema that is already present. Do not assume it is empty, and do not assume it matches production.
2. If it is empty, run the migration files in sorted filename order, beginning at `0001_init.sql`.
3. If it already has part of the history, apply only the missing files, still in filename order, after checking that each file's required tables and functions exist.
4. Do not replay the whole history onto a database that already has tables. Many files are safe to re-run; some are not.
5. Do not copy production customers, payments, invoices, or inventory. Create synthetic staff logins and sample jobs on staging.
6. Then run database-level checks for `0488`–`0491`: a posted invoice cannot be deleted, a cancel rolls back when a reservation release fails, a multi-line receipt rolls back when one line fails, and a missing `void_invoice_payment_safe` does not mark a payment void.

No SQL from this branch has been executed.

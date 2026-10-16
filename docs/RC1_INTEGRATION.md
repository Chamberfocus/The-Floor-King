# CRM launch RC1 integration

Branch `cursor/crm-launch-rc1` starts at `main` `7e479384`, merges PRs #65–#71, and includes the backup schedule from `main` `e4b2dbce`. It is not merged to `main` and the new app is not deployed. On 2026-10-16 the owner applied `0487`–`0492` on production project `ayqcaloqsklvskkudvbs`. Posting stayed off.

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

Migrations stay in numeric order: `0487`, `0488`, `0489`, `0490`, `0491`, then `0492_accounting_outbox_posts_journals.sql` on this branch. `0492` posts journals only when posting is already on. It does not set `posting_enabled` or `books_of_record`.

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

The repo has 489 migration files, from `0001_init.sql` through `0492_accounting_outbox_posts_journals.sql`. An empty database has none of the tables or functions those later files call. `0487`–`0492` are the last six files, not a standalone schema. The repository copy of `main` ends at `0486_reserve_and_start_refuse_archived.sql`. On 2026-10-16 the owner confirmed production is PostgreSQL 17.6 with `profiles` and migration `0486` present, then applied `0487`–`0492`. The check row shows `cancel_job_with_reservations`, `receive_po_lines_safe`, and `acct_post_outbox_item_safe` present, with `posting_enabled` and `books_of_record` false. That SQL Editor run did not write `floor_king_migration_inventory`.

Apply order on a proven staging project, after a human confirms the dashboard ref:

1. Inventory the schema that is already present. Do not assume it is empty, and do not assume it matches production.
2. If it is empty, run the migration files in sorted filename order, beginning at `0001_init.sql`.
3. If it already has part of the history, apply only the missing files, still in filename order, after checking that each file's required tables and functions exist.
4. Do not replay the whole history onto a database that already has tables. Many files are safe to re-run; some are not.
5. Do not copy production customers, payments, invoices, or inventory. Create synthetic staff logins and sample jobs on staging.
6. Then run database-level checks for `0488`–`0491`: a posted invoice cannot be deleted, a cancel rolls back when a reservation release fails, a multi-line receipt rolls back when one line fails, and a missing `void_invoice_payment_safe` does not mark a payment void.

`0492` is recorded on staging `lsrapxmkspocxeeakkcx`. The official staging runner skipped 488 files whose inventory sha256 still matched and applied `0492_accounting_outbox_posts_journals.sql` once. Inventory is now 489 applied rows and 0 applying. The recorded sha256 matches the file. The six function bodies match the file. `posting_enabled` and `books_of_record` stayed false, and journals stayed at 0. Production now has the same six files applied by the owner in the SQL Editor. The production inventory table was not updated by that run.

## Employee operations while QuickBooks stays official

Customers, estimates, purchasing, inventory, scheduling, jobs, and invoices commit their own rows when `posting_enabled` is false. `enqueue_accounting_outbox_safe` returns null before it inserts an outbox row or a journal. `0492` does not change that early return. Invoices and manual payments are operational CRM records. They are not the official ledger. QuickBooks stays the official accounting system.

Do not set `posting_enabled`, any event posting flag, or `books_of_record`. The admin settings form cannot turn those flags on; a direct SQL update still could, and this release does not include one. Do not enter opening balances. Do not request accountant validation. Do not configure email, SMS, or live card processing. Card payments recorded in the CRM stay manual records.

Role access already in the app:

| Work | Roles |
| --- | --- |
| Customers, estimates, invoices | admin, office, sales_manager, salesman |
| Calendar | those roles plus scheduler |
| Install schedule | admin, office, scheduler |
| Jobs | those roles plus crew |
| Inventory | admin, office, warehouse, sales_manager |
| Warehouse | admin, office, warehouse |
| Purchase orders | admin, office |
| Accounting page | admin, office. The posting controls are admin-only and disabled for this release. |

Employees use the accounts already on the production project. This release does not create logins and does not read the production user list.

## Production release procedure

Do not run this until the owner approves this pull request. Do not create a Vercel project. The existing site is the `floorking-crm` project.

1. Recovery point: the owner confirmed Supabase daily physical backups for `ayqcaloqsklvskkudvbs`, latest 2026-10-16 14:28:03 UTC. The custom Google Drive backup still fails with `PG_DUMP:auth` and is not the launch gate. Never restore a backup onto the live project.
2. Schema through `0486` was confirmed on that production database before the six new files were applied.
3. `0487`–`0492` are already applied. Do not run them again. `posting_enabled` and `books_of_record` are false.
4. After the owner approves this pull request, merge it into `main`. That deploys the existing Vercel project `floorking-crm`. The app reads `workflow_stages.outcome`, cancels jobs with `cancel_job_with_reservations`, and receives purchase orders with `receive_po_lines_safe`. Do not add Resend, Twilio, Telnyx, Stripe, or Google Maps keys. `vercel.json` crons stay `/api/cron/daily` and `/api/cron/backup`.
5. Smoke one existing employee login: open a customer, an estimate, a purchase order, inventory, the calendar, a job, and an invoice. Confirm Accounting still shows posting OFF and books of record NO. Confirm QuickBooks is unchanged.

## Rollback

If the new deployment is bad, roll the Vercel deployment back to the current production deployment, `e4b2dbce`, and leave the SQL in place. Those files do not enable posting. The previous app does not call the new functions. The new delete guards reject some deletes the old screens used to perform. That is the safe direction during a live day. Do not drop `0487`–`0491` to undo the release.

Remove `0492` only when posting is off and the outbox and journals are empty. Restore `enqueue_accounting_outbox_safe` from `0177_f6_p5_financial_reporting_control_center.sql` and `installer_labor_record_vendor_event` from `0174_f6_p3a_installer_labor_accounting.sql`, then drop `acct_post_outbox_item_safe(uuid)`, `acct_vendor_bill_posting_payload(uuid, jsonb)`, `acct_outbox_posting_plan(jsonb)`, and `acct_outbox_idempotency_key(jsonb)`. Do not change posting flags in that script.

Never restore a backup onto the live production project.

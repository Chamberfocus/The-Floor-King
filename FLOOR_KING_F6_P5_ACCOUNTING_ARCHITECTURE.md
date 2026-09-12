# F6-P5 — Accounting control architecture (read-only contract)

This file documents the Floor King F6-P5 accounting control surface. It is **not** a go-live of the general ledger. Posting remains **OFF**. Do not set `posting_enabled` true from this document.

## Scope

- Migration **0177** (`0177_f6_p5_accounting_control.sql`) is the schema companion.
- Production proof script (manual / environmental, not PR CI): `scripts/verify-f6-p5-production.mjs`.
- F6-P5 does **not** enable books-of-record posting.

## ACCOUNTING SOURCE

The accounting source of truth for F6-P5 control flags is the accounting-control tables and RPCs introduced with **0177**. Application code must not invent a second posting flag.

## OPERATIONAL SOURCE

The operational source of truth for jobs, invoices, inventory, and CRM workflow remains the existing operational tables (`jobs`, `invoices`, `invoice_payments`, inventory, etc.). Operational CRM rows are not rewritten by F6-P5.

## Warehouse

The warehouse / inventory operational path stays on operational inventory documents. F6-P5 does not post warehouse movements to the GL while posting flags are OFF.

## HISTORICAL AR POLICY

Historical AR is **not** auto-posted. Existing commercial invoices remain operational until an explicit, later historical-AR policy is confirmed. Do not invent balances from a second formula.

## HISTORICAL AP POLICY

Historical AP is **not** auto-posted. Vendor bills remain operational until an explicit, later historical-AP policy is confirmed.

## RETAINED EARNINGS / FY POLICY

Retained earnings and fiscal-year close are **not** activated by F6-P5. `unclosed_earnings` is the named bucket for earnings that have not been closed; do not close FY from this document.

## TRIAL BALANCE PERIOD CONTRACT

Trial balance period is a reporting contract only. Periods must not be treated as posted books while posting flags are OFF.

## Unsupported / snapshot language

- `HISTORICAL_COMMERCIAL_UNSUPPORTED` — historical commercial GL conversion is unsupported in F6-P5.
- `approval_snapshot` — estimate/job approval snapshots remain operational documents, not GL journals.

## Status

Posting flags OFF. `posting_enabled` is false. This architecture is documentation for tests and operators; it does not mutate production business data.

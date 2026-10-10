# RC1 staging database setup

This prepares an automated apply for draft PR #72. It does not apply SQL, connect to a database, change Vercel, or merge the pull request.

Production project ref: `ayqcaloqsklvskkudvbs`. That ref is refused wherever it appears.
Staging project ref: `lsrapxmkspocxeeakkcx`. Apply and prove run only when the connection string identifies that ref and a second authorization is present.

`supabase_migrations.schema_migrations` is not the apply history. SQL Editor runs are not the apply history. The only resume record is `public.floor_king_migration_inventory`, and only `apply` writes it.

## Readiness

The 488 files from `0001_init.sql` through `0491_atomic_po_receive.sql` can be applied to an empty Supabase project in filename order. Filename order does not go backwards. The bundle sha256 of `filename:sha256` lines is `adef49d4ef39ffaf60d989a9560b0c68bed5db42f1d9328d44c28cb508d6238d`.

They cannot be applied to vanilla PostgreSQL. `0001_init.sql` references `auth.users` and creates a trigger on it. Later files reference `auth.uid()`, `auth.jwt()`, `storage.buckets`, and `storage.objects`, and they grant to `anon`, `authenticated`, and `service_role`.

An empty database is one where `profiles`, `customers`, `jobs`, `invoices`, and `workflow_stages` are all absent and `floor_king_migration_inventory` is absent. `apply` creates the inventory table and then runs every file.

A database that already has one of those tables and does not have the inventory table is partial and untracked. `apply` refuses it. SQL Editor history cannot be reconstructed. Use a new empty database on `lsrapxmkspocxeeakkcx`.

When the inventory table exists, `apply` skips a file whose recorded sha256 matches, refuses a recorded hash that differs, and refuses a gap where a later file is recorded and an earlier file is not.

## Execution shape

| Mode | Files | How `apply` runs them |
| --- | ---: | --- |
| single-transaction | 196 | `psql -1` so a failure rolls the file back |
| file-managed (`begin;` / `commit;` in the file) | 288 | no extra `-1`, so the file's own `commit` is the boundary |
| autocommit (`ALTER TYPE ... ADD VALUE`) | 4 | no extra `-1` |

The four autocommit files are `0010_installer_warehouse.sql`, `0017_roles_scoping.sql`, `0059_installer_pickup.sql`, and `0113_po_numbers_vendors.sql`. They compare new enum values as text. Wrapping them in an outer transaction is unnecessary and is not done.

No file uses `CREATE INDEX CONCURRENTLY` or `VACUUM`. No file contains `DROP TABLE`. Seven files contain `DELETE` text. Six of those deletes live inside functions (`0155`, `0172`, `0173`, `0174`, `0175`, `0482`) and do not run during apply. `0077_padding_combine.sql` deletes estimate questions by id; on an empty database that matches zero rows. Three hundred files update `public.estimate_questions` by id. On a clean database those updates change zero rows. Guided-estimate question content will not match production. Do not copy production rows to fill those ids.

The runner applies every SQL file that exists. Numbers `0185`, `0188`, and `0480` are not in the repository, so they are not skipped files.

Extensions named in SQL are `pg_trgm` and `btree_gist`, both `create extension if not exists`. Supabase provides both. Five files mention them.

## Beyond the SQL files

Auth is a Supabase platform schema, not something these files create. The project must already have `auth.users`. After the schema is applied, create synthetic staff users in the staging Auth dashboard. Do not import production users.

Storage buckets `documents` (private) and `branding` (public) are inserted by `0019_documents.sql` and `0026_branding.sql`. The `job-files` bucket is not inserted by SQL. `0008_job_files.sql` states it must exist before photo and signature uploads. Create that bucket in the staging dashboard before those uploads. The storage policies themselves are in the SQL.

No other extension is required by the migration files.

## Commands

Dry-run, no connection:

```bash
npm run staging:dry-run
```

Gate check, no connection:

```bash
STAGING_DATABASE_URL='postgresql://postgres.lsrapxmkspocxeeakkcx:PASSWORD@db.lsrapxmkspocxeeakkcx.supabase.co:5432/postgres' \
node scripts/staging-migrate.mjs check-gates
```

Read-only inventory, only after the URL is the staging ref. This command connects and changes nothing:

```bash
STAGING_DATABASE_URL='postgresql://postgres.lsrapxmkspocxeeakkcx:PASSWORD@db.lsrapxmkspocxeeakkcx.supabase.co:5432/postgres' \
node scripts/staging-migrate.mjs inventory
```

Apply is a separate authorization. Do not run it until that authorization is given. The password stays in the shell for that command. Do not write it into `.env.local` or Vercel.

```bash
STAGING_DATABASE_URL='postgresql://postgres.lsrapxmkspocxeeakkcx:PASSWORD@db.lsrapxmkspocxeeakkcx.supabase.co:5432/postgres' \
FLOOR_KING_STAGING_APPLY=lsrapxmkspocxeeakkcx \
node scripts/staging-migrate.mjs apply --authorize-staging-apply
```

Then the same two variables, with `prove` instead of `apply`. `scripts/staging/rc1-transaction-tests.sql` ends with `ROLLBACK`.

```bash
STAGING_DATABASE_URL='postgresql://postgres.lsrapxmkspocxeeakkcx:PASSWORD@db.lsrapxmkspocxeeakkcx.supabase.co:5432/postgres' \
FLOOR_KING_STAGING_APPLY=lsrapxmkspocxeeakkcx \
node scripts/staging-migrate.mjs prove --authorize-staging-apply
```

`psql` must be installed on the machine that runs `inventory`, `apply`, or `prove`. Dry-run and check-gates do not need it.

## Database tests

`prove` checks that the SQL file ends with `ROLLBACK`, then runs it with `ON_ERROR_STOP`. The script inserts fictional customers, jobs, invoices, payments, labor, and purchase orders. It sets `request.jwt.claims` to `{"role":"service_role"}` so the accounting role gate can see a service-role request. If that setting is not visible to `auth.jwt()`, the first assertion fails and nothing is committed.

| Migration | What the test requires |
| --- | --- |
| 0487 | A stage named `RC1 install follow-up` with outcome `lost` stays `lost`. Outcome `nope` is rejected. |
| 0488 | A sent invoice delete raises `POSTED_INVOICE`. A bare draft invoice can be deleted. A draft with a payment raises `PAYMENT_HISTORY`. A payment delete raises `PAYMENT_HISTORY`. |
| 0489 | A completed job returns `JOB_COMPLETED` and stays completed. A job with no reservation becomes `cancelled`. A reservation whose release key was already used raises `RESERVATION_RELEASE_FAILED` and the job stays `unscheduled`. |
| 0490 | Deleting a labor row, or the unscheduled job that owns it, raises `JOB_FINANCIAL_HISTORY`. |
| 0491 | Receiving a valid first line and an over-quantity second line raises `INV_OVER_RECEIVE` or `PO_RECEIVE_FAILED` and leaves no `stock_movements` for that purchase order. An in-range receive posts a movement and leaves the purchase order `ordered`. |

## Shortest later procedure

1. In the Supabase dashboard, confirm the open project ref is `lsrapxmkspocxeeakkcx`.
2. Use a new empty database on that project. If tables already exist and `floor_king_migration_inventory` does not, stop.
3. Confirm Auth is enabled. Create the `job-files` storage bucket. Leave `documents` and `branding` to the SQL files.
4. Export only the staging connection string as `STAGING_DATABASE_URL` in that shell.
5. Run `npm run staging:dry-run`.
6. After a separate approval, run the `apply` command above, then `prove`.
7. Create synthetic staff users in staging Auth. Point a local app at the staging keys. Leave the existing Preview deployment unused until its Supabase URL is proven to be `lsrapxmkspocxeeakkcx`.

## Complexity

One supervised pass of 488 files. The runner stops on the first error. A second run skips files whose inventory sha256 still matches. The long files are the flooring-knowledge series and `0481_job_true_up.sql`. This is one ordered `psql` pass, not 488 manual pastes.

## Not done here

No database was contacted. `apply` and `prove` were not run. Production was not used. Vercel was not changed. PR #72 was not merged.

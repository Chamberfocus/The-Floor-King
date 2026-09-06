# Floor King CRM — Backup & Disaster Recovery Runbook

**Status:** Automated offsite backup implementation is in the repo. A backup is not production-proven until a real production run succeeds and this runbook’s restore-validation checklist is completed against that run’s artifacts.

**Audience:** Owner / admin.

**Never restore onto live production.** Always restore into a new/isolated Supabase project first.

---

## 1. What this system is

| Item | Value |
|------|--------|
| Architecture | Vercel Cron (production only) → `pg_dump` of `public` → stream Storage objects → upload to private Google Drive |
| Executor | Vercel Function `GET/POST /api/cron/backup` (`maxDuration` 300s) |
| Schedule | `15 8 * * *` (08:15 UTC ≈ 04:15 America/New_York) |
| Google auth | Vercel OIDC → Google STS → impersonate `floor-king-crm-backup@floor-king-crm.iam.gserviceaccount.com` |
| Permanent Google keys | **None.** No service-account JSON. No `credential_source.file`. |
| Drive root | Folder **Floor King CRM Backups** id `1bUgNiTHpXuJaMTAsbpRayJdOT_icUjeD` (Restricted) |
| Database method | Real `pg_dump --format=plain --schema=public` gzipped (`public.sql.gz`) |
| Storage method | Recursive list of every bucket + per-object stream to Drive `storage/{bucket}/{path}` |
| Retention | ≥7 successful daily runs; ≥4 successful weekly points (Sunday UTC copy) |
| Failure monitoring | `Logs/health.json` + owner email with an error **code only** |

Accounting/cutover flags are **not** part of backup. External accounting remains official.

---

## 2. What is backed up

**Included (application database):**

- `public` schema: tables, data, functions, triggers, views, sequences, RLS policies, indexes
- Privileges as emitted by `pg_dump` (see restore caveats — do not blindly replay GRANTs onto a new Supabase project)
- Migration-created application state that lives in `public`

**Best-effort (not required for SUCCESS):**

- `auth` schema dump to `auth.sql.gz` when the database role can dump it

**Included (Storage):**

- `documents` (private) — customer files, measurements, job documents
- `job-files` (private) — work-order / job attachments
- `branding` (public) — logo/brand assets
- Any other buckets returned by the Storage API

**Not claimed recoverable unless the dump actually contains them:**

- `auth.users` / GoTrue internals (only if `auth.sql.gz` is present and restore into Auth succeeds)
- Supabase-managed schemas (`realtime`, `vault`, `extensions` owners, dashboard config)
- PITR (Free plan does not provide owner-controlled PITR)
- Vercel env vars, Stripe/Telnyx/Resend secrets (not in Drive manifests)

---

## 3. Drive layout

```
Floor King CRM Backups/
  Daily/YYYY-MM-DD/{backupId}/
    IN_PROGRESS | SUCCESS | FAILED
    database/public.sql.gz
    database/auth.sql.gz          (optional)
    storage/{bucket}/...
    storage/inventory.jsonl
    manifest.json
    checksums.sha256
  Weekly/YYYY-Www/{backupId}/     (Sunday UTC copy of the dump)
  Logs/health.json
  Logs/lock.json
```

A run is **SUCCESS** only after database dump validation, complete Storage accounting, Drive upload, checksums, and a sample read-back. Partial runs stay `FAILED` or `IN_PROGRESS`. Previous valid backups are never deleted because today failed.

---

## 4. OWNER ACTION — production prerequisites

1. Confirm Google Drive API is enabled on GCP project `floor-king-crm` (number `737192191836`).
2. Confirm the WIF provider ID. Code defaults to `vercel-floor-king-crm`. If the console ID differs, set Vercel env `GOOGLE_WIF_PROVIDER_ID` (non-secret).
3. Confirm Vercel OIDC / Secure Backend Access is enabled for production.
4. Set Vercel **production** env:
   - `CRON_SECRET` (already used by `/api/cron/daily`; backup **fails closed** if missing)
   - `SUPABASE_DB_URL` — **direct** Postgres URI, port **5432**, `sslmode=require`. Not the transaction pooler (`6543`).
   - Existing `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` (Storage list/download)
5. Do **not** create a Google service-account JSON key.
6. Do **not** make the Drive folder public.
7. Apply no migration 0180 for backup.

---

## 5. Restore scenarios (isolated project only)

### 5.1 Accidental customer/job deletion

Prefer row-level recovery from `public.sql.gz` (extract COPY data for the table) into a **side** project, verify, then copy specific rows. Do not overlay production.

### 5.2 Bad application deployment

Roll back the Vercel deployment. Database backup is not required unless the release also mutated data.

### 5.3 Corrupted production database

1. Create a **new** Supabase project.
2. Restore `public.sql.gz` with `gunzip -c public.sql.gz | psql ...` after reviewing privilege errors (`--no-owner` dump still may contain GRANTs — skip unknown roles).
3. Restore Storage from Drive using inventory.jsonl.
4. Point a non-production app env at the new project and smoke-test.
5. Only then plan a cutover.

### 5.4 Total Supabase project loss

Same as 5.3, plus recreate Auth users if `auth.sql.gz` is missing/invalid (staff invites; customer portal users re-invited). Storage must be restored from Drive; SQL dump does not contain file bytes.

### 5.5 Missing Storage objects only

Re-upload from Drive `storage/{bucket}/{path}` with the service role. Match `inventory.jsonl` paths and checksums.

### 5.6 Complete database + Storage loss

Follow 5.4 end-to-end. Verify checksums.sha256 before declaring recovery done.

### Exact restore order

1. New Supabase project (never production).
2. Restore `database/public.sql.gz` (schema + data).
3. Restore Storage objects from Drive per `inventory.jsonl`.
4. Restore Auth only if `auth.sql.gz` validated.
5. Non-production app smoke-test (login, customer file, invoice, job documents).
6. Do not enable accounting flags as part of restore.

---

## 6. Local / isolated restore validation

Against artifacts downloaded from Drive (not production DB):

```bash
node scripts/validate-backup-restore.mjs \
  --dump public.sql.gz \
  --checksums checksums.sha256 \
  --inventory inventory.jsonl
```

This checks dump headers, completeness, schema presence, and SHA-256. It does **not** write to production.

If `psql` / `pg_restore` is installed, you may additionally restore into a local Postgres or a throwaway Supabase project.

---

## 7. Monitoring

- Admin-only card on Accounting control center (production): last attempt, last success, age, db/storage/drive/verify results.
- `Logs/health.json` in Drive.
- Failure email to the owner with an error code (no customer PII, no secrets).

Ordinary CRM roles cannot invoke `/api/cron/backup`. Preview/dev OIDC subjects are rejected.

---

## 8. Known limitations

- Vercel Functions have a 300s budget and limited memory. This architecture is sized for Floor King’s current/near-term data. If dumps or Storage grow beyond that window, STOP and move the dump executor (do not mark partial runs SUCCESS).
- Free-plan Supabase has no owner PITR.
- `pg_dump` of `public` is not a byte-for-byte clone of a Supabase project (Auth/Storage internals).
- Weekly copies currently prioritize the database dump as the weekly recovery point; daily runs hold full Storage.
- Real customer data remains **HOLD** until a production backup + isolated restore validation actually pass.

---

## 9. Pre-migration backup checklist

```text
[ ] Last Drive SUCCESS is recent (Logs/health.json)
[ ] Confirmed which Supabase project is production
[ ] Will not restore over production
[ ] Accounting flags will remain unchanged
```

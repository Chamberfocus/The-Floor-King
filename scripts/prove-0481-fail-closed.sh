#!/usr/bin/env bash
# MANUAL / LOCAL DISPOSABLE DATABASE ONLY.
# Not part of default PR CI. Never points at Supabase, staging, or production.
#
# Proves migration 0481 is fail-closed on clones of the local scratch schema.
# Requires: PROVE_0481_DISPOSABLE=YES
# Uses: sudo -n -u postgres, databases named fk481_* only.
# Refuses if a connection URL is present in the environment.
set -euo pipefail

if [[ "${PROVE_0481_DISPOSABLE:-}" != "YES" ]]; then
  echo "Refusing to run. Set PROVE_0481_DISPOSABLE=YES to use local fk481_* databases only." >&2
  exit 2
fi

for key in DATABASE_URL SUPABASE_DB_URL SUPABASE_URL DIRECT_URL; do
  if [[ -n "${!key:-}" ]]; then
    echo "Refusing to run: ${key} is set. This script is local-only." >&2
    exit 2
  fi
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/supabase/migrations/0481_job_true_up.sql"
REPORT="${REPORT_PATH:-/tmp/0481-proof-report.txt}"
: > "$REPORT"

psql_pg() {
  sudo -n -u postgres psql -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

psql_db() {
  local db="$1"
  shift
  sudo -n -u postgres psql -d "$db" -v ON_ERROR_STOP=1 "$@"
}

log() {
  printf '%s\n' "$*" | tee -a "$REPORT"
}

cleanup() {
  sudo -n -u postgres psql -d postgres -q -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'fk481_%' AND pid <> pg_backend_pid();" \
    >/dev/null 2>&1 || true
  local db
  while read -r db; do
    [[ -z "$db" ]] && continue
    sudo -n -u postgres psql -d postgres -q -c "DROP DATABASE IF EXISTS \"${db}\";" >/dev/null
  done < <(sudo -n -u postgres psql -d postgres -At -c "SELECT datname FROM pg_database WHERE datname LIKE 'fk481_%' ORDER BY 1;")
}
trap cleanup EXIT

clone_db() {
  local name="$1"
  if [[ "$name" != fk481_* ]]; then
    echo "Refusing to create database $name" >&2
    exit 2
  fi
  psql_pg -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('floorking_pre480', '${name}') AND pid <> pg_backend_pid();" >/dev/null
  psql_pg -c "DROP DATABASE IF EXISTS ${name};"
  psql_pg -c "CREATE DATABASE ${name} TEMPLATE floorking_pre480;"
}

schema_left() {
  local db="$1"
  psql_db "$db" -At -c "
    SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'job_true_ups','job_true_up_entries','job_true_up_snapshots',
        'job_commission_ledger','job_commission_payments',
        'job_commission_payment_lines','job_true_up_audit'
      );
  "
}

funcs_left() {
  local db="$1"
  psql_db "$db" -At -c "
    SELECT count(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'fk_true_up_cents','fk_commission_rate_bps','fk_commission_amount_cents',
        'fk_margin_hundredths','fk_true_up_assert_staff','fk_true_up_assert_admin',
        'job_true_up_calculate','ensure_job_true_up','record_true_up_entry',
        'approve_job_true_up','refresh_true_up_collection','record_late_true_up_adjustment',
        'set_true_up_collection_override','set_true_up_commission_override',
        'set_true_up_salesperson','mark_commission_lines_paid','list_job_true_up_queue',
        'count_job_true_up_queue','job_true_up_dashboard','job_commission_statement',
        'job_true_up_profitability','job_true_up_performance'
      );
  "
}

expect_abort() {
  local label="$1"
  local db="$2"
  local needle="$3"
  local err
  set +e
  err="$(psql_db "$db" --single-transaction -v ON_ERROR_STOP=1 -f "$SQL" 2>&1)"
  local code=$?
  set -e
  local tables funcs
  tables="$(schema_left "$db")"
  funcs="$(funcs_left "$db")"
  if [[ "$code" -eq 0 ]]; then
    log "FAIL ${label}: migration succeeded"
    return 1
  fi
  if ! grep -q "$needle" <<<"$err"; then
    log "FAIL ${label}: abort did not contain [$needle]"
    log "$err"
    return 1
  fi
  if [[ "$tables" != "0" || "$funcs" != "0" ]]; then
    log "FAIL ${label}: partial schema remains tables=${tables} funcs=${funcs}"
    return 1
  fi
  log "PASS ${label}: aborted, tables=0 funcs=0"
}

log "0481 fail-closed proof"
log "template=floorking_pre480 local only"

# --- A-J mutations, each on a fresh clone ---------------------------------
clone_db fk481_a
psql_db fk481_a -c "DROP TABLE public.job_labor;"
expect_abort A fk481_a "0481 preflight: required relation public.job_labor is missing"

clone_db fk481_b
psql_db fk481_b -c "ALTER TABLE public.job_labor DROP COLUMN amount;"
expect_abort B fk481_b "0481 preflight: required column job_labor.amount is missing"

clone_db fk481_c
psql_db fk481_c -c "ALTER TABLE public.job_labor ALTER COLUMN amount TYPE text USING amount::text;"
expect_abort C fk481_c "0481 preflight: job_labor.amount type is incompatible"

clone_db fk481_d
psql_db fk481_d -c "ALTER TYPE public.job_status RENAME VALUE 'completed' TO 'finished';"
expect_abort D fk481_d "0481 preflight: job_status is missing completed"

clone_db fk481_e
psql_db fk481_e -c "CREATE FUNCTION public.invoice_open_ar_balance(p_invoice_id uuid, p_extra int) RETURNS numeric LANGUAGE sql AS \$\$ SELECT 0::numeric \$\$;"
expect_abort E fk481_e "0481 preflight: invoice_open_ar_balance must already exist as one function"

clone_db fk481_f
psql_db fk481_f -c "ALTER TABLE public.customers DROP CONSTRAINT customers_assigned_to_fkey;"
expect_abort F fk481_f "0481 preflight: customers.assigned_to must reference auth.users"

clone_db fk481_g
psql_db fk481_g -c "CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS \$\$ SELECT public.user_role(auth.uid()) IN ('admin', 'office', 'salesman'); \$\$;"
expect_abort G fk481_g "0481 preflight: is_staff() is not limited to administrator and office"

clone_db fk481_h
psql_db fk481_h -c "ALTER TABLE public.stock_movements DROP CONSTRAINT stock_movements_source_type_check; ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_source_type_check CHECK (source_type = ANY (ARRAY['po_receipt','manual_receive','job_pull','job_reserve','job_release','adjust','vendor_return','reversal','legacy']));"
expect_abort H fk481_h "0481 preflight: stock movement source_type is missing job_return"

clone_db fk481_i
psql_db fk481_i -c "ALTER TYPE public.invoice_status RENAME VALUE 'sent' TO 'mailed';"
expect_abort I fk481_i "0481 preflight: invoice_status is missing sent"

clone_db fk481_j
psql_db fk481_j -c "ALTER TABLE public.installer_bills DROP CONSTRAINT installer_bills_status_check; ALTER TABLE public.installer_bills ADD CONSTRAINT installer_bills_status_check CHECK (status = ANY (ARRAY['draft','paid','void','cancelled']));"
expect_abort J fk481_j "0481 preflight: installer bill status is missing draft, approved, or paid"

# --- K halfway DDL inside one transaction ---------------------------------
python3 - "$SQL" /tmp/0481-halfway.sql << 'PY'
import pathlib, sys
text = pathlib.Path(sys.argv[1]).read_text()
needle = "create table if not exists public.job_true_ups ("
idx = text.find(needle)
end = text.find("\n);\n", idx)
if idx < 0 or end < 0:
    raise SystemExit("could not find first table close")
inject = "\ndo $$\nbegin\n  raise exception '0481 injected halfway';\nend $$;\n"
pathlib.Path(sys.argv[2]).write_text(text[: end + 4] + inject + text[end + 4 :])
PY
clone_db fk481_k
set +e
kerr="$(psql_db fk481_k --single-transaction -v ON_ERROR_STOP=1 -f /tmp/0481-halfway.sql 2>&1)"
kcode=$?
set -e
kt="$(schema_left fk481_k)"
kf="$(funcs_left fk481_k)"
if [[ "$kcode" -eq 0 ]] || ! grep -q "0481 injected halfway" <<<"$kerr" || [[ "$kt" != "0" || "$kf" != "0" ]]; then
  log "FAIL K: code=${kcode} tables=${kt} funcs=${kf}"
  log "$kerr"
  exit 1
fi
log "PASS K: halfway DDL rolled back, tables=0 funcs=0"

# --- counts + re-run on a seeded clone ------------------------------------
clone_db fk481_counts
psql_db fk481_counts -At -c "
SELECT relname || ' ' || cnt FROM (
  SELECT c.relname,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text AS cnt
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
) s ORDER BY 1;
" > /tmp/fk481-before.txt
before_flags="$(psql_db fk481_counts -At -c "SELECT posting_enabled::text || ' ' || books_of_record::text || ' ' || coalesce(backup_pitr_confirmed_at::text, 'null') FROM public.accounting_settings;")"
before_tables="$(wc -l < /tmp/fk481-before.txt | tr -d ' ')"
log "before_tables=${before_tables}"
log "before_accounting=${before_flags}"

psql_db fk481_counts --single-transaction -v ON_ERROR_STOP=1 -f "$SQL" >/tmp/fk481-apply1.txt
psql_db fk481_counts -At -c "
SELECT relname || ' ' || cnt FROM (
  SELECT c.relname,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text AS cnt
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
) s ORDER BY 1;
" > /tmp/fk481-after.txt
after_flags="$(psql_db fk481_counts -At -c "SELECT posting_enabled::text || ' ' || books_of_record::text || ' ' || coalesce(backup_pitr_confirmed_at::text, 'null') FROM public.accounting_settings;")"

python3 - << 'PY'
from pathlib import Path
before = dict(line.rsplit(" ", 1) for line in Path("/tmp/fk481-before.txt").read_text().splitlines() if line.strip())
after = dict(line.rsplit(" ", 1) for line in Path("/tmp/fk481-after.txt").read_text().splitlines() if line.strip())
new = [
    "job_true_ups", "job_true_up_entries", "job_true_up_snapshots",
    "job_commission_ledger", "job_commission_payments",
    "job_commission_payment_lines", "job_true_up_audit",
]
changed = []
for name, n in before.items():
    if after.get(name) != n:
        changed.append(f"{name} {n} -> {after.get(name)}")
missing_new = [name for name in new if name not in after]
nonzero_new = [f"{name}={after.get(name)}" for name in new if after.get(name) not in (None, "0")]
watch = [
    "accounting_settings", "credit_applications", "credit_memos", "customer_deposits",
    "customers", "estimates", "expenses", "installer_bills", "invoice_items",
    "invoice_write_offs", "invoices", "jobs", "journal_entries", "journal_lines",
    "payments", "po_items", "purchase_orders", "refunds", "stock_movements",
]
watched = "\n".join(f"{name} {before.get(name, 'MISSING')} -> {after.get(name, 'MISSING')}" for name in watch)
Path("/tmp/fk481-count-diff.txt").write_text(
    "changed\n" + ("\n".join(changed) if changed else "(none)") + "\n"
    + "missing_new\n" + ("\n".join(missing_new) if missing_new else "(none)") + "\n"
    + "nonzero_new\n" + ("\n".join(nonzero_new) if nonzero_new else "(none)") + "\n"
    + "new_counts\n" + "\n".join(f"{name} {after.get(name, 'MISSING')}" for name in new) + "\n"
    + "watched\n" + watched + "\n"
)
if changed or missing_new or nonzero_new:
    raise SystemExit(1)
PY
log "PASS row counts: every pre-existing table unchanged; new true-up tables are 0"
log "after_accounting=${after_flags}"
if [[ "$before_flags" != "$after_flags" ]]; then
  log "FAIL accounting flags changed"
  exit 1
fi
log "PASS accounting flags unchanged (${after_flags})"
cat /tmp/fk481-count-diff.txt >> "$REPORT"

psql_db fk481_counts --single-transaction -v ON_ERROR_STOP=1 -f "$SQL" >/tmp/fk481-apply2.txt
new_after_rerun="$(psql_db fk481_counts -At -c "
  SELECT string_agg(relname || '=' || cnt, ' ' ORDER BY relname) FROM (
    SELECT c.relname,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text AS cnt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname IN (
        'job_true_ups','job_true_up_entries','job_true_up_snapshots',
        'job_commission_ledger','job_commission_payments',
        'job_commission_payment_lines','job_true_up_audit'
      )
  ) s;
")"
if [[ "$new_after_rerun" != *"job_true_ups=0"* ]] || [[ "$new_after_rerun" == *"=1"* ]]; then
  log "FAIL L: re-run counts ${new_after_rerun}"
  exit 1
fi
log "PASS L: second apply succeeded and new tables stayed empty (${new_after_rerun})"

# --- existing completed job does not earn a commission --------------------
clone_db fk481_hist
psql_db fk481_hist -v ON_ERROR_STOP=1 << 'SQL'
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('11111111-1111-1111-1111-111111111111', 'hist-sales@example.test', '{"role":"salesman"}'::jsonb);
INSERT INTO public.customers (full_name, assigned_to) VALUES ('Synthetic Historical Customer', '11111111-1111-1111-1111-111111111111');
INSERT INTO public.jobs (customer_id, status, title, completed_at)
SELECT id, 'completed', 'Synthetic historical job', now() FROM public.customers WHERE full_name = 'Synthetic Historical Customer';
SQL
psql_db fk481_hist --single-transaction -v ON_ERROR_STOP=1 -f "$SQL" >/dev/null
hist_out="$(psql_db fk481_hist -At -c "
SELECT
  (SELECT count(*) FROM public.job_true_ups) || ' ' ||
  (SELECT count(*) FROM public.job_commission_ledger) || ' ' ||
  (SELECT count(*) FROM public.jobs WHERE status = 'completed');
")"
log "hist_trueups_ledger_completed=${hist_out}"
if [[ "$hist_out" != "0 0 1" ]]; then
  log "FAIL historical job created commission rows"
  exit 1
fi
psql_db fk481_hist -v ON_ERROR_STOP=1 -c "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('11111111-1111-1111-1111-111111111112', 'hist-admin@example.test', '{\"role\":\"admin\"}'::jsonb);"
queue_out="$(psql_db fk481_hist -q -v ON_ERROR_STOP=1 -At << 'SQL'
BEGIN;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111112', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;
SELECT (SELECT count(*) FROM public.list_job_true_up_queue('needs_true_up', 25, 0))::text
  || ' ' || (SELECT count(*) FROM public.job_true_ups)::text
  || ' ' || (SELECT count(*) FROM public.job_commission_ledger)::text;
ROLLBACK;
SQL
)"
log "hist_queue_trueups_ledger=${queue_out}"
if [[ "$queue_out" != "1 0 0" ]]; then
  log "FAIL historical completed job was not a read-only queue row"
  exit 1
fi
log "PASS existing completed job appears in the needs-true-up queue and creates no commission"

# --- security and idempotency ---------------------------------------------
clone_db fk481_ok
psql_db fk481_ok --single-transaction -v ON_ERROR_STOP=1 -f "$SQL" >/dev/null
psql_db fk481_ok -v ON_ERROR_STOP=1 -f - << 'SQL'
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'tu-admin@example.test', '{"role":"admin"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000002', 'tu-office@example.test', '{"role":"office"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000003', 'tu-sales-a@example.test', '{"role":"salesman"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000004', 'tu-sales-b@example.test', '{"role":"salesman"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000005', 'tu-sched@example.test', '{"role":"scheduler"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000006', 'tu-wh@example.test', '{"role":"warehouse"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000007', 'tu-crew@example.test', '{"role":"crew"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000008', 'tu-cust@example.test', '{"role":"customer"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000009', 'tu-sm@example.test', '{"role":"sales_manager"}'::jsonb);

INSERT INTO public.customers (id, full_name, assigned_to)
VALUES ('b0000000-0000-0000-0000-000000000001', 'Synthetic True-up Customer', 'a0000000-0000-0000-0000-000000000003');
INSERT INTO public.jobs (id, customer_id, status, title, completed_at)
VALUES ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'completed', 'Synthetic true-up job', now());
INSERT INTO public.invoices (id, customer_id, job_id, status, tax_rate, commercial_kind)
VALUES ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'sent', 0, 'original');
INSERT INTO public.invoice_items (invoice_id, description, quantity, rate)
VALUES ('d0000000-0000-0000-0000-000000000001', 'Flooring', 1, 100);

CREATE OR REPLACE FUNCTION public.fk481_query(p_uid uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN SQLERRM;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fk481_exec(p_uid uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql;
  EXECUTE 'RESET ROLE';
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  BEGIN
    EXECUTE 'RESET ROLE';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN SQLERRM;
END;
$fn$;
SQL

behave="$(psql_db fk481_ok -v ON_ERROR_STOP=1 -At << 'SQL'
SELECT public.fk481_query(
  'a0000000-0000-0000-0000-000000000002',
  $q$SELECT public.record_true_up_entry('c0000000-0000-0000-0000-000000000001', 'material', 'confirm_zero', 0, 'Synthetic zero material', '')::text$q$
);
SQL
)"
log "office_material_entry=${behave}"
if [[ "$behave" != *"-"* ]]; then
  log "FAIL office could not record a zero confirmation"
  exit 1
fi

for cat in labor freight other; do
  msg="$(psql_db fk481_ok -v ON_ERROR_STOP=1 -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.record_true_up_entry('c0000000-0000-0000-0000-000000000001', '${cat}', 'confirm_zero', 0, 'Synthetic zero ${cat}', '')::text\$q\$);")"
  log "office_${cat}_entry=${msg}"
  if [[ "$msg" != *"-"* ]]; then
    log "FAIL office ${cat} entry"
    exit 1
  fi
done

refresh_before="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000001', \$q\$SELECT public.refresh_true_up_collection('c0000000-0000-0000-0000-000000000001')\$q\$);")"
ledger_before="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_ledger;")"
log "refresh_before_approval=${refresh_before} ledger=${ledger_before}"
if [[ "$refresh_before" != "not_approved" || "$ledger_before" != "0" ]]; then
  log "FAIL refresh created a commission before approval"
  exit 1
fi

approve1="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT (public.approve_job_true_up('c0000000-0000-0000-0000-000000000001')->>'commission_cents')\$q\$);")"
earned1="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_ledger WHERE kind = 'earned';")"
log "approve_commission_cents=${approve1} earned_rows=${earned1}"
if [[ "$approve1" != "800" || "$earned1" != "1" ]]; then
  log "FAIL first approval"
  exit 1
fi

approve2="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT (public.approve_job_true_up('c0000000-0000-0000-0000-000000000001')->>'commission_cents')\$q\$);")"
earned2="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_ledger WHERE kind = 'earned';")"
log "second_approve=${approve2} earned_rows=${earned2}"
if [[ "$approve2" != *"already approved"* || "$earned2" != "1" ]]; then
  log "FAIL double approve"
  exit 1
fi
log "PASS double approve does not duplicate the earned commission"

refresh_after="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.refresh_true_up_collection('c0000000-0000-0000-0000-000000000001')\$q\$);")"
earned_refresh="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_ledger;")"
log "refresh_after=${refresh_after} ledger_rows=${earned_refresh}"
if [[ "$earned_refresh" != "1" ]]; then
  log "FAIL refresh duplicated ledger rows"
  exit 1
fi
log "PASS refresh does not create a commission"

psql_db fk481_ok -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.record_true_up_entry('c0000000-0000-0000-0000-000000000001', 'labor', 'manual_amount', 5000, 'Synthetic late labor', 'vendor bill')::text\$q\$);" >/dev/null
late1="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT (public.record_late_true_up_adjustment('c0000000-0000-0000-0000-000000000001', 'Synthetic late labor')->>'adjustment_cents')\$q\$);")"
late2="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT (public.record_late_true_up_adjustment('c0000000-0000-0000-0000-000000000001', 'Synthetic late labor retry')->>'adjustment_cents')\$q\$);")"
adj_n="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_ledger WHERE kind = 'adjustment';")"
log "late1=${late1} late2=${late2} adjustment_rows=${adj_n}"
if [[ "$late1" != "-400" || "$late2" != "0" || "$adj_n" != "1" ]]; then
  log "FAIL late-cost idempotency"
  exit 1
fi
log "PASS late-cost recalculation does not duplicate the adjustment"

office_override="$(psql_db fk481_ok -At -c "SELECT public.fk481_exec('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.set_true_up_collection_override('c0000000-0000-0000-0000-000000000001', 'office should not')\$q\$);")"
office_amount="$(psql_db fk481_ok -At -c "SELECT public.fk481_exec('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.set_true_up_commission_override('c0000000-0000-0000-0000-000000000001', 'amount', 1, 'office should not')\$q\$);")"
log "office_collection_override=${office_override}"
log "office_amount_override=${office_amount}"
if [[ "$office_override" != *"Not authorized."* || "$office_amount" != *"Not authorized."* ]]; then
  log "FAIL office override"
  exit 1
fi
log "PASS office has no owner-only commission or collection override"

admin_override="$(psql_db fk481_ok -At -c "SELECT public.fk481_exec('a0000000-0000-0000-0000-000000000001', \$q\$SELECT public.set_true_up_collection_override('c0000000-0000-0000-0000-000000000001', 'Synthetic collection override')\$q\$);")"
log "admin_collection_override=${admin_override}"
if [[ "$admin_override" != "ok" ]]; then
  log "FAIL admin collection override"
  exit 1
fi

payable="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_ledger WHERE status = 'payable';")"
log "payable_lines=${payable}"
if [[ "$payable" != "2" ]]; then
  log "FAIL admin override did not make both lines payable"
  exit 1
fi
log "PASS admin collection override"

ledger_ids="$(psql_db fk481_ok -At -c "SELECT string_agg(id::text, ',') FROM public.job_commission_ledger;")"
pay1="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.mark_commission_lines_paid('a0000000-0000-0000-0000-000000000003', string_to_array('${ledger_ids}', ',')::uuid[], current_date, 'SYNTH', current_date, current_date, 'pay-key-1')::text\$q\$);")"
pay2="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.mark_commission_lines_paid('a0000000-0000-0000-0000-000000000003', string_to_array('${ledger_ids}', ',')::uuid[], current_date, 'SYNTH', current_date, current_date, 'pay-key-1')::text\$q\$);")"
pay_n="$(psql_db fk481_ok -At -c "SELECT count(*) FROM public.job_commission_payments;")"
log "pay1=${pay1} pay2=${pay2} payments=${pay_n}"
if [[ "$pay1" != "$pay2" || "$pay_n" != "1" || "$pay1" != *"-"* ]]; then
  log "FAIL payment retry"
  exit 1
fi
log "PASS payment retry returns the same payment"

pay_other="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT public.mark_commission_lines_paid('a0000000-0000-0000-0000-000000000003', string_to_array('${ledger_ids}', ',')::uuid[], current_date, 'SYNTH', current_date, current_date, 'pay-key-2')::text\$q\$);")"
log "pay_other_key=${pay_other}"
if [[ "$pay_other" != *"already paid"* ]]; then
  log "FAIL a second payment key was accepted"
  exit 1
fi
log "PASS a different payment key cannot pay the same lines again"

# Role denials
deny_sales_approve="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000003', \$q\$SELECT public.approve_job_true_up('c0000000-0000-0000-0000-000000000001')::text\$q\$);")"
deny_sales_calc="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000003', \$q\$SELECT public.job_true_up_calculate('c0000000-0000-0000-0000-000000000001')::text\$q\$);")"
own_stmt="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000003', \$q\$SELECT (public.job_commission_statement('a0000000-0000-0000-0000-000000000003', null, null, 'all', 25, 0)->'totals'->>'commission_earned_cents') || ':' || (public.job_commission_statement('a0000000-0000-0000-0000-000000000003', null, null, 'all', 25, 0)->'totals'->>'owed_cents')\$q\$);")"
other_stmt="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000004', \$q\$SELECT public.job_commission_statement('a0000000-0000-0000-0000-000000000003', null, null, 'all', 25, 0)::text\$q\$);")"
log "sales_approve=${deny_sales_approve}"
log "sales_calc=${deny_sales_calc}"
log "sales_own_owed=${own_stmt}"
log "sales_other=${other_stmt}"
if [[ "$deny_sales_approve" != *"Not authorized."* || "$deny_sales_calc" != *"Not authorized."* || "$other_stmt" != *"Not authorized."* || "$own_stmt" != "800:0" ]]; then
  log "FAIL salesperson scope"
  exit 1
fi
log "PASS salesperson reads own statement only and cannot approve or calculate"

for role in scheduler warehouse crew customer sales_manager; do
  case "$role" in
    scheduler) uid=a0000000-0000-0000-0000-000000000005 ;;
    warehouse) uid=a0000000-0000-0000-0000-000000000006 ;;
    crew) uid=a0000000-0000-0000-0000-000000000007 ;;
    customer) uid=a0000000-0000-0000-0000-000000000008 ;;
    sales_manager) uid=a0000000-0000-0000-0000-000000000009 ;;
  esac
  calc="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT public.job_true_up_calculate('c0000000-0000-0000-0000-000000000001')::text\$q\$);")"
  stmt="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT public.job_commission_statement('a0000000-0000-0000-0000-000000000003', null, null, 'all', 25, 0)::text\$q\$);")"
  prof="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT public.job_true_up_profitability(null, null, null, 25, 0)::text\$q\$);")"
  perf="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT public.job_true_up_performance(null, null, 25, 0)::text\$q\$);")"
  rows="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT (SELECT count(*) FROM public.job_commission_ledger)::text\$q\$);")"
  trueups="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT (SELECT count(*) FROM public.job_true_ups)::text\$q\$);")"
  snaps="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('${uid}', \$q\$SELECT (SELECT count(*) FROM public.job_true_up_snapshots)::text\$q\$);")"
  log "${role}_calc=${calc}"
  log "${role}_stmt=${stmt}"
  log "${role}_profit=${prof}"
  log "${role}_perf=${perf}"
  log "${role}_ledger_rows=${rows} trueups=${trueups} snapshots=${snaps}"
  if [[ "$calc" != *"Not authorized."* || "$stmt" != *"Not authorized."* || "$prof" != *"Not authorized."* || "$perf" != *"Not authorized."* || "$rows" != "0" || "$trueups" != "0" || "$snaps" != "0" ]]; then
    log "FAIL ${role} financial access"
    exit 1
  fi
  log "PASS ${role} has no commission financial access"
done

sales_a_rows="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000003', \$q\$SELECT (SELECT count(*) FROM public.job_commission_ledger)::text\$q\$);")"
sales_b_rows="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000004', \$q\$SELECT (SELECT count(*) FROM public.job_commission_ledger)::text\$q\$);")"
admin_rows="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000001', \$q\$SELECT (SELECT count(*) FROM public.job_commission_ledger)::text\$q\$);")"
office_rows="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000002', \$q\$SELECT (SELECT count(*) FROM public.job_commission_ledger)::text\$q\$);")"
log "rls admin=${admin_rows} office=${office_rows} sales_a=${sales_a_rows} sales_b=${sales_b_rows}"
if [[ "$admin_rows" != "2" || "$office_rows" != "2" || "$sales_a_rows" != "2" || "$sales_b_rows" != "0" ]]; then
  log "FAIL RLS visibility"
  exit 1
fi
log "PASS RLS: admin and office see the ledger; salesperson A sees own lines; salesperson B sees none"

insert_denied="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000001', \$q\$SELECT 1 FROM public.job_commission_ledger WHERE false\$q\$);")"
# Direct insert must fail even for admin. Use a statement that attempts INSERT via fk481 by executing it.
insert_msg="$(psql_db fk481_ok -At -c "SELECT public.fk481_query('a0000000-0000-0000-0000-000000000001', \$q\$WITH x AS (INSERT INTO public.job_commission_ledger (salesperson_id, job_id, true_up_id, kind, amount_cents, status, idempotency_key) VALUES ('a0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001',(SELECT id FROM public.job_true_ups LIMIT 1),'earned',1,'payable','direct-insert') RETURNING id::text) SELECT id FROM x\$q\$);")"
log "direct_insert=${insert_msg}"
if [[ "$insert_msg" != *"permission denied"* ]]; then
  log "FAIL authenticated insert was not denied"
  exit 1
fi
log "PASS direct ledger insert is denied for authenticated, including admin"

log "PROOF COMPLETE"

#!/usr/bin/env bash
# Floor King — apply remaining Guided Estimate SQL 0380–0476.
# Does NOT rerun batches 01–03 (0190–0379).
# Does NOT enable accounting.
# STOP ON FIRST ERROR.
#
# ONE Mac Terminal command (after owner approval):
#
#   APPLY_REMAINING_0380_0476=YES \
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<PASSWORD>@aws-0-....pooler.supabase.com:5432/postgres' \
#   bash /path/to/apply-remaining-0380-0476.sh
#
# Use the DIRECT / session connection on port 5432. Do not use port 6543 (transaction pooler).
# This script never prints SUPABASE_DB_URL.

set -euo pipefail
# do not set -x (would leak the URL)

HERE="$(cd "$(dirname "$0")" && pwd)"
SQL="$HERE/GUIDED_ESTIMATE_REMAINING_0380_0476.sql"
POST="$HERE/VERIFY_REMAINING_0380_0476_READONLY.sql"

if [[ "${APPLY_REMAINING_0380_0476:-}" != "YES" ]]; then
  echo "Refusing to deploy. Remaining 0380–0476 is prepared but not approved."
  echo "After approval, run with APPLY_REMAINING_0380_0476=YES and SUPABASE_DB_URL set."
  echo "SQL file: $SQL"
  exit 2
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is not set. Copy the direct Postgres URI from Supabase → Settings → Database."
  echo "Do not paste it into chat."
  exit 2
fi

case "$SUPABASE_DB_URL" in
  *":6543"*)
    echo "SAFETY STOP: URI looks like the transaction pooler (port 6543)."
    echo "Use the direct/session URI on port 5432."
    exit 3
    ;;
esac

if [[ ! -f "$SQL" ]]; then
  echo "Missing remaining SQL: $SQL"
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is not installed. On a Mac: brew install libpq && brew link --force libpq"
  exit 2
fi

# Never rerun 0190–0379
if grep -q -- '-- BEGIN 0190_flooring_knowledge_engine.sql' "$SQL"; then
  echo "SAFETY STOP: remaining file unexpectedly contains 0190."
  exit 3
fi
if grep -q -- '-- BEGIN 0379_' "$SQL"; then
  echo "SAFETY STOP: remaining file unexpectedly contains 0379."
  exit 3
fi
if ! grep -q -- '-- BEGIN 0380_flooring_knowledge_line_measurements_carton.sql' "$SQL"; then
  echo "SAFETY STOP: remaining file missing 0380 start marker."
  exit 3
fi
if ! grep -q -- '-- END 0476_flooring_knowledge_scope_room_taped_sqft.sql' "$SQL"; then
  echo "SAFETY STOP: remaining file missing 0476 end marker."
  exit 3
fi

echo "Applying remaining Guided Estimate SQL 0380–0476 (single transaction)."
echo "Batches 01–03 (0190–0379) will NOT be rerun."
echo "Accounting flags will not be set."

# -X: ignore .psqlrc. ON_ERROR_STOP: abort on first error (rolls back this transaction).
# URL is passed as a positional argument and is not echoed.
psql --no-psqlrc -X -v ON_ERROR_STOP=1 -f "$SQL" "$SUPABASE_DB_URL"

echo "Remaining SQL finished. Running read-only post-verify…"
psql --no-psqlrc -X -v ON_ERROR_STOP=1 -f "$POST" "$SUPABASE_DB_URL"

echo "DONE remaining 0380–0476. Send the post-verify result (not the URI)."

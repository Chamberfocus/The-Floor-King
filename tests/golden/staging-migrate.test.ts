/**
 * Staging migration gate. These tests never open a database connection.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const STAGING_REF = "lsrapxmkspocxeeakkcx";
const PRODUCTION_REF = "ayqcaloqsklvskkudvbs";
const STAGING_URL = `postgresql://postgres:not-a-secret@db.${STAGING_REF}.supabase.co:5432/postgres`;

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["scripts/staging-migrate.mjs", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      STAGING_DATABASE_URL: "",
      SUPABASE_DB_URL: "",
      FLOOR_KING_STAGING_APPLY: "",
      ...env,
    },
  });
}

describe("staging migration gate", () => {
  const source = readFileSync("scripts/staging-migrate.mjs", "utf8");
  const proveSql = readFileSync("scripts/staging/rc1-transaction-tests.sql", "utf8");

  it("dry-run lists the historical files and does not connect", () => {
    const result = run(["dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Database contacted: no");
    expect(result.stdout).toContain("Migration files: 488");
    expect(result.stdout).toContain("First file: 0001_init.sql");
    expect(result.stdout).toContain("Last file: 0491_atomic_po_receive.sql");
    expect(result.stdout).toContain("Filename order backwards: 0");
    expect(result.stdout).toContain(`Required project ref: ${STAGING_REF}`);
    expect(result.stdout).toContain(`Blocked project ref: ${PRODUCTION_REF}`);
    expect(result.stdout).toContain("001 0001_init.sql");
    expect(result.stdout).toContain("488 0491_atomic_po_receive.sql");
    expect(result.stdout).toContain("Apply is not authorized by this command.");
    expect(result.stdout).not.toContain("Applying ");
  });

  it("refuses apply when the staging URL is present and authorization is absent", () => {
    const result = run(["apply"], { STAGING_DATABASE_URL: STAGING_URL });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Refusing to apply");
    expect(result.stderr).toContain("no file was executed");
    expect(result.stdout).not.toContain("Applying ");
  });

  it("refuses a URL that contains the production ref", () => {
    const mixed = `postgresql://postgres.${STAGING_REF}:not-a-secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres`;
    const result = run(["check-gates"], { STAGING_DATABASE_URL: mixed });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("gate: PRODUCTION_REF");
    expect(result.stdout).toContain("apply_authorized: no");
    expect(result.stdout).toContain("connect: no");
  });

  it("refuses a different project ref", () => {
    const other = "postgresql://postgres:not-a-secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
    const result = run(["check-gates"], { STAGING_DATABASE_URL: other });
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("gate: WRONG_PROJECT");
    expect(result.stdout).toContain("connect: no");
  });

  it("recognizes staging and still withholds apply until both authorizations are set", () => {
    const closed = run(["check-gates"], { STAGING_DATABASE_URL: STAGING_URL });
    expect(closed.status).toBe(0);
    expect(closed.stdout).toContain(`ref: ${STAGING_REF}`);
    expect(closed.stdout).toContain("gate: STAGING");
    expect(closed.stdout).toContain("apply_authorized: no");
    expect(closed.stdout).toContain("connect: no");

    const open = run(["check-gates", "--authorize-staging-apply"], {
      STAGING_DATABASE_URL: STAGING_URL,
      FLOOR_KING_STAGING_APPLY: STAGING_REF,
    });
    expect(open.status).toBe(0);
    expect(open.stdout).toContain("apply_authorized: yes");
    expect(open.stdout).toContain("connect: no");
  });

  it("does not load .env.local", () => {
    expect(source).not.toMatch(/readFileSync\([^)]*\.env/);
    expect(source).not.toContain("dotenv");
    expect(source).toContain("STAGING_DATABASE_URL");
    expect(source).toContain("supabase_migrations.schema_migrations is not the apply history");
  });

  it("keeps the database tests behind rollback and does not run them", () => {
    expect(proveSql.trim().toLowerCase().endsWith("rollback;")).toBe(true);
    expect(proveSql).toContain("POSTED_INVOICE");
    expect(proveSql).toContain("PAYMENT_HISTORY");
    expect(proveSql).toContain("RESERVATION_RELEASE_FAILED");
    expect(proveSql).toContain("JOB_FINANCIAL_HISTORY");
    expect(proveSql).toContain("INV_OVER_RECEIVE");
    expect(proveSql).toContain("RC1 install follow-up");
    expect(source).toContain("The test file must end with ROLLBACK.");

    const prove = run(["prove"], { STAGING_DATABASE_URL: STAGING_URL });
    expect(prove.status).not.toBe(0);
    expect(prove.stderr).toContain("Refusing to run database tests");
    expect(prove.stdout).not.toContain("Running RC1 transaction tests");
  });
});

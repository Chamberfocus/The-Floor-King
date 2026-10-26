/**
 * Staging migration gate. These tests never open a database connection.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  connectionEnv,
  decideResume,
  dnsSetsAreSafe,
  executeApplyPlan,
  inventoryClearSql,
  inventoryWriteSql,
  loadMigrationPlan,
  normalizeIp,
  parseStagingTarget,
  proveSqlAllowed,
  psqlArgv,
  scrubSecrets,
  serverIdentityVerdict,
  STAGING_HOST,
  STAGING_REF,
} from "../../scripts/staging-migrate.mjs";

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
    expect(result.stdout).toContain("Migration files: 496");
    expect(result.stdout).toContain("First file: 0001_init.sql");
    expect(result.stdout).toContain("Last file: 0500_estimate_line_save_roles.sql");
    expect(result.stdout).toContain("Filename order backwards: 0");
    expect(result.stdout).toContain(`Required project ref: ${STAGING_REF}`);
    expect(result.stdout).toContain(`Blocked project ref: ${PRODUCTION_REF}`);
    expect(result.stdout).toContain("001 0001_init.sql");
    expect(result.stdout).toContain("496 0500_estimate_line_save_roles.sql");
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
    expect(proveSqlAllowed(proveSql).code).toBe("PROVE_SQL_OK");

    const prove = run(["prove"], { STAGING_DATABASE_URL: STAGING_URL });
    expect(prove.status).not.toBe(0);
    expect(prove.stderr).toContain("Refusing to run database tests");
    expect(prove.stdout).not.toContain("Running RC1 transaction tests");
  });

  it("accepts the staging session pooler and refuses other pooler URLs before any connection", () => {
    const pooler = `postgresql://postgres.${STAGING_REF}:not-a-secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
    const pooled = run(["check-gates", "--authorize-staging-apply"], {
      STAGING_DATABASE_URL: pooler,
      FLOOR_KING_STAGING_APPLY: STAGING_REF,
    });
    expect(pooled.status).toBe(0);
    expect(pooled.stdout).toContain("gate: STAGING");
    expect(pooled.stdout).toContain("connect: no");

    const wrongUser = "postgresql://postgres:not-a-secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    const refusedUser = run(["check-gates"], { STAGING_DATABASE_URL: wrongUser });
    expect(refusedUser.status).toBe(2);
    expect(refusedUser.stdout).toContain("gate: POOLER_REFUSED");
    expect(refusedUser.stdout).toContain("connect: no");

    const transactionPooler = `postgresql://postgres.${STAGING_REF}:not-a-secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
    const refusedPort = run(["check-gates"], { STAGING_DATABASE_URL: transactionPooler });
    expect(refusedPort.status).toBe(2);
    expect(refusedPort.stdout).toContain("gate: PORT_NOT_DIRECT");
    expect(refusedPort.stdout).toContain("connect: no");

    const disguised = `postgresql://postgres:not-a-secret@192.0.2.1:5432/postgres?options=${STAGING_REF}`;
    const hidden = run(["apply", "--authorize-staging-apply"], {
      STAGING_DATABASE_URL: disguised,
      FLOOR_KING_STAGING_APPLY: STAGING_REF,
    });
    expect(hidden.status).not.toBe(0);
    expect(hidden.stderr).toContain("Refusing to connect");
    expect(hidden.stdout).not.toContain("Applying ");
    expect(hidden.stdout).not.toContain("Server identity");
  });

  it("refuses prove against the production host even when apply is authorized", () => {
    const productionUrl = `postgresql://postgres:not-a-secret@db.${PRODUCTION_REF}.supabase.co:5432/postgres`;
    const result = run(["prove", "--authorize-staging-apply"], {
      STAGING_DATABASE_URL: productionUrl,
      FLOOR_KING_STAGING_APPLY: STAGING_REF,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PRODUCTION_REF");
    expect(result.stdout).not.toContain("Running RC1 transaction tests");
  });
});

type PlanFile = { filename: string; sha256: string; execution: string };

describe("staging execution safety", () => {
  const hash = (seed: string) => seed.repeat(64).slice(0, 64);
  const plan = [
    { filename: "0001_init.sql", sha256: hash("a"), execution: "single-transaction" },
    { filename: "0190_flooring_knowledge_engine.sql", sha256: hash("b"), execution: "file-managed" },
    { filename: "0491_atomic_po_receive.sql", sha256: hash("c"), execution: "single-transaction" },
  ];

  it("confirms server identity from DNS addresses, not from the URL", () => {
    const staging = ["2001:db8::10", "192.0.2.10"];
    const production = ["2001:db8::20"];
    expect(serverIdentityVerdict("2001:db8:0:0:0:0:0:10", staging, production).code).toBe(
      "SERVER_IS_STAGING",
    );
    expect(serverIdentityVerdict("2001:db8::20", staging, production).code).toBe(
      "SERVER_IS_PRODUCTION",
    );
    expect(serverIdentityVerdict("203.0.113.5", staging, production).code).toBe(
      "SERVER_NOT_STAGING",
    );
    expect(dnsSetsAreSafe(staging, staging).code).toBe("DNS_OVERLAP");
    expect(normalizeIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
    expect(normalizeIp("2600:1f18:45ac:6d01:3fcd:66f1:3794:3951/128")).toBe(
      "2600:1f18:45ac:6d01:3fcd:66f1:3794:3951",
    );
  });

  it("does not resume a file left in applying, including one with its own transaction", () => {
    const recorded = new Map([
      ["0001_init.sql", { sha256: hash("a"), status: "applied" }],
      ["0190_flooring_knowledge_engine.sql", { sha256: hash("b"), status: "applying" }],
    ]);
    const calls: string[] = [];
    const outcome = executeApplyPlan(plan, recorded, {
      markApplying: () => calls.push("mark-applying"),
      runFile: () => {
        calls.push("run");
        return { ok: true };
      },
      clearApplying: () => calls.push("clear"),
      markApplied: () => calls.push("mark-applied"),
    });
    expect(outcome.code).toBe("INTERRUPTED");
    expect(outcome.filename).toBe("0190_flooring_knowledge_engine.sql");
    expect(calls).toEqual([]);
  });

  it("stops on the first SQL failure and does not record that file as applied", () => {
    const ran: string[] = [];
    const outcome = executeApplyPlan(plan, new Map(), {
      markApplying: (row: PlanFile) => ran.push(`applying:${row.filename}`),
      runFile: (row: PlanFile) => {
        ran.push(`run:${row.filename}`);
        return { ok: row.execution !== "file-managed" };
      },
      clearApplying: (row: PlanFile) => ran.push(`clear:${row.filename}`),
      markApplied: (row: PlanFile) => ran.push(`applied:${row.filename}`),
    });
    expect(outcome.code).toBe("SQL_FAILED");
    expect(outcome.filename).toBe("0190_flooring_knowledge_engine.sql");
    expect(ran).toEqual([
      "applying:0001_init.sql",
      "run:0001_init.sql",
      "applied:0001_init.sql",
      "applying:0190_flooring_knowledge_engine.sql",
      "run:0190_flooring_knowledge_engine.sql",
    ]);
    expect(
      outcome.actions
        .filter((action) => action.filename === "0190_flooring_knowledge_engine.sql")
        .map((action) => action.type),
    ).toEqual(["mark-applying", "stop"]);
    expect(outcome.actions.some((action) => action.filename === "0491_atomic_po_receive.sql")).toBe(
      false,
    );
  });

  it("clears only a rolled-back single-transaction failure and keeps hashes in order", () => {
    const ran: string[] = [];
    const failing = executeApplyPlan(plan, new Map(), {
      markApplying: (row: PlanFile) => ran.push(`applying:${row.filename}`),
      runFile: (row: PlanFile) => {
        ran.push(`run:${row.filename}`);
        return { ok: false };
      },
      clearApplying: (row: PlanFile) => ran.push(`clear:${row.filename}`),
      markApplied: (row: PlanFile) => ran.push(`applied:${row.filename}`),
    });
    expect(failing.actions.map((action) => action.type)).toEqual([
      "mark-applying",
      "clear-applying",
      "stop",
    ]);
    expect(ran).toEqual(["applying:0001_init.sql", "run:0001_init.sql", "clear:0001_init.sql"]);

    const recorded = new Map<string, { sha256: string; status: string }>();
    const first = executeApplyPlan(plan, recorded, {
      markApplying: () => undefined,
      runFile: () => ({ ok: true }),
      clearApplying: () => undefined,
      markApplied: () => undefined,
    });
    expect(first.actions.map((action) => action.type)).toEqual([
      "mark-applying",
      "mark-applied",
      "mark-applying",
      "mark-applied",
      "mark-applying",
      "mark-applied",
    ]);
    const second = executeApplyPlan(plan, recorded, {
      markApplying: () => {
        throw new Error("should not apply twice");
      },
      runFile: () => {
        throw new Error("should not apply twice");
      },
      clearApplying: () => undefined,
      markApplied: () => {
        throw new Error("should not apply twice");
      },
    });
    expect(second.actions.map((action) => action.type)).toEqual(["skip", "skip", "skip"]);
    expect(decideResume(recorded, [{ ...plan[0], sha256: hash("z") }]).code).toBe("HASH_MISMATCH");
    expect(
      decideResume(new Map([["0491_atomic_po_receive.sql", { sha256: hash("c"), status: "applied" }]]), plan)
        .code,
    ).toBe("GAP");
  });

  it("keeps passwords out of psql arguments and scrubs them from output", () => {
    const target = parseStagingTarget(STAGING_URL);
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    const argv = psqlArgv(["-f", "supabase/migrations/0001_init.sql"]);
    expect(argv.join(" ")).not.toContain("not-a-secret");
    expect(argv).not.toContain("-d");
    const env = connectionEnv(
      { PATH: "/usr/bin", PGHOST: PRODUCTION_REF, STAGING_DATABASE_URL: STAGING_URL },
      target,
      "2001:db8::10",
    );
    expect(env.PGHOST).toBe(STAGING_HOST);
    expect(env.PGHOSTADDR).toBe("2001:db8::10");
    expect(env.PGSSLMODE).toBe("verify-full");
    const pooledTarget = parseStagingTarget(
      `postgresql://postgres.${STAGING_REF}:not-a-secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    );
    expect(pooledTarget.ok).toBe(true);
    if (pooledTarget.ok) {
      const pooledEnv = connectionEnv({ PATH: "/usr/bin" }, pooledTarget, "2001:db8::10");
      expect(pooledEnv.PGHOST).toBe("aws-0-us-east-1.pooler.supabase.com");
      expect(pooledEnv.PGHOSTADDR).toBeUndefined();
      expect(pooledEnv.PGUSER).toBe(`postgres.${STAGING_REF}`);
      expect(pooledEnv.PGSSLMODE).toBe("verify-full");
      expect(pooledEnv.PGSSLROOTCERT).toContain("supabase-root-2021.crt");
    }
    expect("STAGING_DATABASE_URL" in env).toBe(false);
    expect(env.PGPASSWORD).toBe("not-a-secret");
    const scrubbed = scrubSecrets(`connection failed for not-a-secret at ${STAGING_URL}`, [target.password]);
    expect(scrubbed).not.toContain("not-a-secret");
    expect(scrubbed).toContain(STAGING_HOST);
    expect(inventoryWriteSql("0001_init.sql", hash("a"), "applied")).toContain("status = 'applying'");
    expect(inventoryClearSql("0001_init.sql")).toContain("status = 'applying'");
    expect(() => inventoryWriteSql("not a file", hash("a"), "applying")).toThrow("REFUSING_SQL_TOKEN");
  });

  it("accepts the real migration set and the rollback-only prove script", () => {
    const loaded = loadMigrationPlan();
    expect(loaded.files).toHaveLength(496);
    expect(loaded.backwards).toEqual([]);
    expect(loaded.plan.some((row) => row.execution === "unsafe-transaction")).toBe(false);
    expect(loaded.plan.filter((row) => row.enumAdd).every((row) => row.execution === "autocommit")).toBe(
      true,
    );
    expect(proveSqlAllowed(readFileSync("scripts/staging/rc1-transaction-tests.sql", "utf8")).code).toBe(
      "PROVE_SQL_OK",
    );
    const source = readFileSync("scripts/staging-migrate.mjs", "utf8");
    const applyFn = source.slice(source.indexOf("function commandApply"));
    const proveFn = source.slice(source.indexOf("function commandProve"));
    expect(applyFn.indexOf("openStagingConnection")).toBeGreaterThan(-1);
    expect(applyFn.indexOf("openStagingConnection")).toBeLessThan(applyFn.indexOf("executeApplyPlan"));
    expect(proveFn.indexOf("proveSqlAllowed")).toBeLessThan(proveFn.indexOf("openStagingConnection"));
    expect(proveFn.indexOf("openStagingConnection")).toBeLessThan(proveFn.indexOf('["-f", PROVE_SQL]'));
    expect(source).not.toContain('"-d"');
  });
});

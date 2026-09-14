/**
 * 0188 operational snapshot detach + final customer reset markers.
 * No production mutation.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = join(process.cwd());
const mig0188 = join(
  ROOT,
  "supabase/migrations/0188_estimate_approval_snapshot_operational_detach.sql",
);
const reset = join(ROOT, "scripts/owner/customer_reset_final.sql");
const customersPage = readFileSync(
  join(ROOT, "src/app/(app)/customers/page.tsx"),
  "utf8",
);
const estimatesPage = readFileSync(
  join(ROOT, "src/app/(app)/estimates/page.tsx"),
  "utf8",
);
const jobsPage = readFileSync(join(ROOT, "src/app/(app)/jobs/page.tsx"), "utf8");
const searchPage = readFileSync(
  join(ROOT, "src/app/(app)/search/page.tsx"),
  "utf8",
);
const snapshotType = readFileSync(
  join(ROOT, "src/lib/estimate-approval.ts"),
  "utf8",
);

function stripComments(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

describe("0188 snapshot operational detach", () => {
  it("exists and keeps append-only delete protection", () => {
    expect(existsSync(mig0188)).toBe(true);
    const sql = readFileSync(mig0188, "utf8");
    const body = stripComments(sql);
    expect(sql).toContain("P0_0188_PRECHECK");
    expect(sql).toContain("P0_0188_POSTCHECK");
    expect(sql).toContain("historical_estimate_id");
    expect(sql).toContain("historical_customer_id");
    expect(sql).toContain("historical_customer_name");
    expect(sql).toContain("alter column estimate_id drop not null");
    expect(sql).toMatch(/on delete set null/i);
    expect(sql).toContain(
      "estimate_approval_snapshots are append-only; delete is not allowed",
    );
    expect(sql).toContain("operational detach to NULL");
    expect(body).not.toMatch(/disable\s+trigger/i);
    expect(body).not.toMatch(/\bset\s+session_replication_role\b/i);
    expect(body).not.toMatch(/posting_enabled\s*=\s*true/i);
    expect(body).not.toMatch(/books_of_record\s*=\s*true/i);
    expect(body).not.toContain("job_notes");
    expect(body).not.toMatch(
      /delete\s+from\s+public\.estimate_approval_snapshots/i,
    );
    expect(body).not.toMatch(/\btruncate\b/i);
    const hash = createHash("sha256").update(readFileSync(mig0188)).digest("hex");
    expect(hash).toHaveLength(64);
  });
});

describe("customer_reset_final.sql", () => {
  it("is a fail-closed transactional reset that preserves snapshots", () => {
    expect(existsSync(reset)).toBe(true);
    const sql = readFileSync(reset, "utf8");
    const body = stripComments(sql);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toContain("ALREADY_CLEAN");
    expect(sql).toContain("historical_estimate_id");
    expect(sql).toContain("apply migration 0188 first");
    expect(sql).toContain("delete from public.customers");
    expect(body).toMatch(/\bwork_notes\b/);
    expect(body).not.toMatch(/\bjob_notes\b/);
    expect(body).not.toMatch(/disable\s+trigger/i);
    expect(body).not.toMatch(/\bset\s+session_replication_role\b/i);
    expect(body).not.toMatch(/\bunnest\s*\(/i);
    expect(body).not.toMatch(/\bwith\s+ordinality\b/i);
    expect(body).not.toMatch(/\btruncate\b/i);
    expect(body).not.toMatch(/delete\s+from\s+public\.products/i);
    expect(body).not.toMatch(/delete\s+from\s+public\.suppliers/i);
    expect(body).not.toMatch(/delete\s+from\s+auth\.users/i);
    expect(body).not.toMatch(
      /delete\s+from\s+public\.estimate_approval_snapshots/i,
    );
    expect(body).not.toContain("storage.objects");
    expect(sql).toContain("Storage objects are NOT");
    expect(sql).toContain("RESET INCOMPLETE: % customers remain");
    const hash = createHash("sha256").update(readFileSync(reset)).digest("hex");
    expect(hash).toHaveLength(64);
  });
});

describe("empty CRM after customer reset", () => {
  it("customers / estimates / jobs / search render empty states", () => {
    expect(customersPage).toContain("No customers yet");
    expect(customersPage).toContain("Add your first lead to get started.");
    expect(customersPage).toContain('href="/customers/new"');
    expect(estimatesPage).toContain("EmptyState");
    expect(jobsPage).toContain("EmptyState");
    expect(searchPage).toContain("No matches for");
  });

  it("approval snapshot live estimate_id may be null after detach", () => {
    expect(snapshotType).toContain("estimate_id: string | null");
  });
});

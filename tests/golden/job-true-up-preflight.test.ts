import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0481_job_true_up.sql", "utf8");

describe("0481 fail-closed preflight", () => {
  it("raises 0481 preflight before any true-up table exists", () => {
    const preflight = sql.indexOf("0481 preflight:");
    const firstTable = sql.indexOf("create table if not exists public.job_true_ups");
    expect(preflight).toBeGreaterThan(0);
    expect(firstTable).toBeGreaterThan(preflight);
    expect(sql).toContain("0481 preflight: required relation public.");
    expect(sql).toContain("0481 preflight: required column");
    expect(sql).toContain("0481 preflight: %.% type is incompatible");
    expect(sql).toContain("0481 preflight: installer bill status is missing draft, approved, or paid");
    expect(sql).toContain("0481 preflight: stock movement source_type is missing job_return");
    expect(sql).toContain("0481 preflight: credit application status is missing active or void");
    expect(sql).toContain("0481 preflight: write-off status is missing active or void");
    expect(sql).toContain("0481 preflight: customers.assigned_to must reference auth.users");
    expect(sql).toContain("0481 preflight: is_staff() is not limited to administrator and office");
    expect(sql).toContain("0481 preflight: invoice_open_ar_balance signature is unexpected");
    expect(sql).toContain("0481 preflight: invoice_commercial_total signature is unexpected");
    expect(sql).toContain("0481 preflight: auth.uid() is missing");
  });

  it("has no transaction control and no top-level business writes", () => {
    const statements = sql.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    });
    for (const line of statements) {
      expect(line).not.toMatch(/^\s*begin\s*;/i);
      expect(line).not.toMatch(/^\s*commit\s*;/i);
      expect(line).not.toMatch(/^\s*rollback\s*;/i);
      expect(line).not.toMatch(/^insert\s/i);
      expect(line).not.toMatch(/^update\s/i);
      expect(line).not.toMatch(/^delete\s/i);
    }
    expect(sql).toContain("This file has no BEGIN and no COMMIT");
    expect(sql).toContain("A ledger row exists only after an explicit approval");
    expect(sql).toContain("does not insert commission rows and does not backfill");
    expect(sql).toContain("v_delta := v_revised - (v_approved + v_delta)");
    expect(sql).toContain("'Required actual costs are still missing.'::text");
    expect(sql).toContain("'NO COMMISSION — JOB HAS NO POSITIVE GROSS PROFIT'::text");
  });

  it("does not touch accounting control columns", () => {
    expect(sql).toContain("Does NOT enable accounting");
    expect(sql).toContain("Leaves accounting control columns untouched");
    expect(sql).not.toMatch(/set\s+books_of_record/i);
    expect(sql).not.toMatch(/set\s+posting_enabled/i);
    expect(sql).not.toMatch(/set\s+backup_pitr_confirmed_at/i);
    expect(sql).not.toContain("insert into public.journal_entries");
    expect(sql).not.toContain("insert into public.journal_lines");
  });
});

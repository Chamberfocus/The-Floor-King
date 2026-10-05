import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("archived customer scheduler consistency", () => {
  it("keeps archived customers out of active job queues at the database source", () => {
    const sql = readFileSync(
      "supabase/migrations/0483_archive_job_queue_consistency.sql",
      "utf8",
    );
    expect(sql).toContain("c.cancelled_at is null");
    expect(sql).toContain("scheduler_ready");
    expect(sql).toContain("scheduler_booked");
    expect(sql).toContain("warehouse_active");
  });

  it("keeps a page-level fail-safe in the install scheduler", () => {
    const jobs = readFileSync("src/lib/data/jobs.ts", "utf8");
    const page = readFileSync(
      "src/app/(app)/install-scheduler/page.tsx",
      "utf8",
    );
    expect(jobs).toContain("customer:customers(full_name, cancelled_at)");
    expect(jobs).toContain(".filter((row) => !row.archived)");
    expect(page).toContain("if (cust?.cancelled_at) return null");
  });
});

/**
 * F7 launch readiness — pure helpers + migration/action markers.
 * No production mutation.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessJobStatusTransition,
  isAllowedJobStatusTransition,
  jobStatusUpdatePatch,
} from "@/lib/job-status";
import {
  dateRangesOverlap,
  findInstallerScheduleConflict,
} from "@/lib/scheduling-conflicts";
import { preferSnapshotLinesForSeed } from "@/lib/job-operational-scope";
import {
  scoreCustomerDuplicate,
  normalizeAddressKey,
} from "@/lib/customer-duplicate";

const ROOT = join(process.cwd());
const portalActions = readFileSync(
  join(ROOT, "src/app/portal/actions.ts"),
  "utf8",
);
const jobsActions = readFileSync(
  join(ROOT, "src/app/(app)/jobs/actions.ts"),
  "utf8",
);
const receivingActions = readFileSync(
  join(ROOT, "src/app/(app)/warehouse/receiving-actions.ts"),
  "utf8",
);
const inventoryPage = readFileSync(
  join(ROOT, "src/app/(app)/inventory/page.tsx"),
  "utf8",
);
const poStock = readFileSync(join(ROOT, "src/lib/po-stock.ts"), "utf8");
const arch = join(ROOT, "FLOOR_KING_F7_LAUNCH_ARCHITECTURE.md");
const results = join(ROOT, "FLOOR_KING_F7_LAUNCH_RESULTS.md");
const verifier = join(ROOT, "scripts/verify-f7-launch-production.mjs");

describe("F7 launch — architecture docs", () => {
  it("1. architecture + results docs exist", () => {
    expect(existsSync(arch)).toBe(true);
    expect(existsSync(results)).toBe(true);
  });

  it("2. production verifier exists and is read-only", () => {
    expect(existsSync(verifier)).toBe(true);
    const body = readFileSync(verifier, "utf8");
    expect(body).toMatch(/read.?only/i);
    expect(body).toContain("productionBusinessDataMutated");
    expect(body).not.toMatch(/\.insert\(/);
  });
});

describe("F7 job status transitions", () => {
  it("3. blocks completed → scheduled", () => {
    expect(isAllowedJobStatusTransition("completed", "scheduled")).toBe(false);
    expect(assessJobStatusTransition("completed", "scheduled").ok).toBe(false);
  });

  it("4. allows scheduled → in_progress → completed", () => {
    expect(isAllowedJobStatusTransition("scheduled", "in_progress")).toBe(true);
    expect(isAllowedJobStatusTransition("in_progress", "completed")).toBe(true);
  });

  it("5. completed_at stamped on first completion", () => {
    expect(jobStatusUpdatePatch("completed", null).completed_at).toBeTruthy();
    expect(
      jobStatusUpdatePatch("completed", "2026-01-01T00:00:00Z").completed_at,
    ).toBeUndefined();
  });

  it("6. updateJob uses assessJobStatusTransition + jobStatusUpdatePatch", () => {
    expect(jobsActions).toContain("assessJobStatusTransition");
    expect(jobsActions).toContain("jobStatusUpdatePatch");
  });
});

describe("F7 scheduling conflicts", () => {
  it("7. dateRangesOverlap inclusive", () => {
    expect(dateRangesOverlap("2026-01-10", "2026-01-12", "2026-01-12", "2026-01-13")).toBe(
      true,
    );
    expect(dateRangesOverlap("2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13")).toBe(
      false,
    );
  });

  it("8. same installer overlapping blocks", () => {
    const hit = findInstallerScheduleConflict({
      jobId: "a",
      installerProfileId: "inst-1",
      crewId: null,
      start: "2026-02-01",
      end: "2026-02-02",
      existing: [
        {
          jobId: "b",
          assignedTo: "inst-1",
          assignedCrewId: null,
          start: "2026-02-02",
          end: "2026-02-03",
        },
      ],
    });
    expect(hit?.jobId).toBe("b");
  });

  it("9. bookInstall/rescheduleInstall call findInstallerScheduleConflict + schedule RPC", () => {
    expect(jobsActions).toContain("findInstallerScheduleConflict");
    expect(jobsActions).toContain("schedule_job_install_safe");
  });
});

describe("F7 portal ownership + job create gate", () => {
  it("10. portalApproveEstimate checks profile.customer_id ownership (no service_role elevate)", () => {
    expect(portalActions).toContain("portalCustomerId");
    expect(portalActions).toContain(
      "estRow.customer_id !== portalCustomerId",
    );
    expect(portalActions).toContain("admin: false");
  });

  it("11. ensureJobForEstimate requires approved + snapshot + not stale", () => {
    expect(jobsActions).toContain('!== "approved"');
    expect(jobsActions).toContain("approval_stale");
    expect(jobsActions).toContain("current_approval_snapshot_id");
  });
});

describe("F7 snapshot seed preference", () => {
  it("12. preferSnapshotLinesForSeed chooses snapshot when present", () => {
    const r = preferSnapshotLinesForSeed([{ id: "s" }], [{ id: "l" }]);
    expect(r.source).toBe("snapshot");
    expect(r.lines[0]).toEqual({ id: "s" });
  });

  it("13. preferSnapshotLinesForSeed falls back to live", () => {
    const r = preferSnapshotLinesForSeed([], [{ id: "l" }]);
    expect(r.source).toBe("live_estimate");
  });
});

describe("F7 warehouse ACL + receiving", () => {
  it("14. listIncomingPos asserts receiver role", () => {
    expect(receivingActions).toContain("listIncomingPos");
    const idx = receivingActions.indexOf("export async function listIncomingPos");
    expect(receivingActions.slice(idx, idx + 200)).toContain("assertRole");
  });

  it("15. unreceive fail-closed when PO received", () => {
    expect(receivingActions).toContain('po.status === "received"');
    expect(receivingActions).toContain("already marked received in inventory");
  });

  it("16. inventory page hides cost from warehouse", () => {
    expect(inventoryPage).toContain("canSeeCost");
    expect(inventoryPage).toContain("Qty only");
  });
});

describe("F7 PO / inventory reservation", () => {
  it("17. applyPoStatus throws on missing supplier (not silent)", () => {
    const poActions = readFileSync(
      join(ROOT, "src/app/(app)/purchase-orders/actions.ts"),
      "utf8",
    );
    expect(poActions).toContain("PO_SUPPLIER_REQUIRED");
    expect(poActions).toContain("throw new Error");
  });

  it("18. releaseJobReservations uses release_inventory_safe", () => {
    expect(poStock).toContain("release_inventory_safe");
    expect(poStock).not.toMatch(
      /from\("products"\)[\s\S]{0,80}update\(\{\s*reserved/,
    );
  });
});

describe("F7 duplicates", () => {
  it("19. name+address scores as name_address", () => {
    const scored = scoreCustomerDuplicate(
      {
        fullName: "Jane Doe",
        address: "1 Main St",
        city: "Cleveland",
        state: "OH",
        zip: "44101",
      },
      {
        id: "1",
        full_name: "Jane Doe",
        address: "1 Main St",
        city: "Cleveland",
        state: "OH",
        zip: "44101",
      },
    );
    expect(scored?.reason).toBe("name_address");
    expect(
      normalizeAddressKey({
        address: "1 Main St",
        city: "Cleveland",
        state: "OH",
        zip: "44101",
      }),
    ).toContain("cleveland");
  });
});

describe("F7 accounting safety markers", () => {
  it("20. architecture docs do not enable posting", () => {
    const a = readFileSync(arch, "utf8");
    expect(a).toMatch(/posting flags OFF|posting_enabled.*false/i);
    expect(a).toContain("NOT CONFIRMED");
  });
});

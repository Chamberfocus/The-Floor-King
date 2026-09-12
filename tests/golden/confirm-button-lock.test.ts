/**
 * ConfirmButton double-submit lock — shared pending flag, not per-page patches.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmLockSettle,
  confirmLockTryBegin,
  createConfirmLock,
} from "@/lib/confirm-lock";
import { buildApprovalIdempotencyKey } from "@/lib/estimate-approval-idempotency";

const ROOT = join(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("confirm lock — first confirm wins", () => {
  it("first tryBegin executes; second rapid tryBegin is ignored", () => {
    const first = confirmLockTryBegin("idle");
    expect(first.ok).toBe(true);
    expect(first.phase).toBe("pending");

    const second = confirmLockTryBegin(first.phase);
    expect(second.ok).toBe(false);
    expect(second.phase).toBe("pending");
  });

  it("createConfirmLock blocks a second begin until settle", () => {
    const lock = createConfirmLock();
    const runs: string[] = [];
    if (lock.tryBegin()) runs.push("first");
    if (lock.tryBegin()) runs.push("second");
    expect(runs).toEqual(["first"]);
    expect(lock.isPending()).toBe(true);
  });

  it("failure settle releases pending so retry can run once", () => {
    const lock = createConfirmLock();
    expect(lock.tryBegin()).toBe(true);
    lock.settle();
    expect(lock.isPending()).toBe(false);
    expect(confirmLockSettle()).toBe("idle");
    expect(lock.tryBegin()).toBe(true);
    if (lock.tryBegin()) throw new Error("retry must still be single-flight");
  });

  it("successful in-flight attempt cannot double-fire", () => {
    let phase: "idle" | "pending" = "idle";
    let executions = 0;
    const attempt = () => {
      const next = confirmLockTryBegin(phase);
      phase = next.phase;
      if (!next.ok) return;
      executions += 1;
    };
    attempt();
    attempt();
    attempt();
    expect(executions).toBe(1);
  });
});

describe("ConfirmButton uses the shared lock", () => {
  it("flips the lock before invoking onConfirm or form submit", () => {
    const src = read("src/components/ui/confirm-button.tsx");
    expect(src).toContain("createConfirmLock");
    expect(src).toContain("lockRef.current.tryBegin()");
    expect(src).toContain("useFormStatus");
    expect(src).toContain('data-confirm-pending={pending ? "true" : undefined}');
    expect(src).toContain("Working…");
    expect(src).toContain("release()");
    // Confirm must not close the dialog before the lock is held.
    const confirmFn = src.slice(src.indexOf("const confirm = () => {"));
    expect(confirmFn).toMatch(/tryBegin\(\)/);
    expect(confirmFn.indexOf("tryBegin()")).toBeLessThan(
      confirmFn.indexOf("void runConfirm()"),
    );
  });

  it("disables confirm/cancel while pending and ignores dialog dismiss", () => {
    const src = read("src/components/ui/confirm-button.tsx");
    expect(src).toContain("if (lockRef.current.isPending()) return");
    expect(src).toContain("disabled={pending}");
    expect(src).toContain("showCloseButton={!pending}");
  });
});

describe("representative financial ConfirmButton usage", () => {
  it("estimate approve ConfirmButton submits setEstimateStatus", () => {
    const page = read("src/app/(app)/estimates/[id]/page.tsx");
    const block = page.slice(
      page.indexOf("Accept which option?"),
      page.indexOf("Record a decline or change request"),
    );
    expect(block).toContain("ConfirmButton");
    expect(block).toContain('title="Approve this estimate?"');
    expect(page).toContain("action={setEstimateStatus}");
  });

  it("approval RPC key is stable across retries of the same snapshot", () => {
    const a = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "staff",
      optionId: "opt-1",
      snapshotId: "snap-1",
    });
    const b = buildApprovalIdempotencyKey({
      estimateId: "est-1",
      source: "staff",
      optionId: "opt-1",
      snapshotId: "snap-1",
    });
    expect(a).toBe(b);
    expect(a).toContain("est_approve:est-1");
  });

  it("record-payment ConfirmButton shares one PaymentIdempotencyField key", () => {
    const page = read("src/app/(app)/invoices/[id]/page.tsx");
    expect(page).toContain("PaymentIdempotencyField");
    expect(page).toContain('title="Record this payment?"');
    const field = read("src/app/(app)/invoices/payment-idempotency-field.tsx");
    expect(field).toContain("useState");
    expect(field).toContain("randomUUID");
  });

  it("checklist approve still uses ConfirmButton (P1-03)", () => {
    const src = read("src/components/checklist-slots.tsx");
    expect(src).toContain("ConfirmButton");
    expect(src).toContain("checklistCanOneTapApprove");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimateEmailRecipients,
  estimatePhoneRecipients,
  isEstimateEmail,
  isEstimatePhone,
} from "@/lib/estimate-recipients";

const root = process.cwd();

describe("estimate send preview recipients", () => {
  it("keeps the customer address and adds the extras once", () => {
    expect(
      estimateEmailRecipients(" Pat@Example.com ", "pat@example.com, spouse@shop.com; bad"),
    ).toEqual({
      emails: ["pat@example.com", "spouse@shop.com"],
      rejected: ["bad"],
    });
    expect(estimatePhoneRecipients("(216) 555-0100", "2165550100, 216-555-0199")).toEqual({
      phones: ["(216) 555-0100", "216-555-0199"],
      rejected: [],
    });
    expect(isEstimateEmail("not-an-email")).toBe(false);
    expect(isEstimatePhone("555")).toBe(false);
  });

  it("shows the preview and the recipient fields before a send", () => {
    const page = readFileSync(join(root, "src/app/(app)/estimates/[id]/page.tsx"), "utf8");
    const dialog = readFileSync(
      join(root, "src/app/(app)/estimates/estimate-send-dialog.tsx"),
      "utf8",
    );
    const action = readFileSync(
      join(root, "src/app/(app)/estimates/send-preview-actions.ts"),
      "utf8",
    );
    const builder = readFileSync(
      join(root, "src/app/(app)/estimates/estimate-builder.tsx"),
      "utf8",
    );
    expect(page).toContain("EstimateSendDialog");
    expect(page).toContain("Text the quote");
    expect(page).toContain("Record deposit");
    expect(page).toContain("recordVisitDeposit");
    const checklist = readFileSync(join(root, "src/components/checklist-slots.tsx"), "utf8");
    expect(builder).toContain("?send=1");
    expect(builder).toContain("sendEstimateById(estimate.id, false)");
    expect(checklist).toContain("/estimates/${estimate.id}?send=1");
    expect(checklist).toContain("Send it");
    expect(dialog).toContain("Preview before you send");
    expect(dialog).toContain("Additional emails");
    expect(dialog).toContain("Additional phones");
    expect(dialog).toContain("?preview=1");
    expect(action).toContain("saveOnCustomer");
    expect(action).toContain("quoteText");
    expect(action).toContain('status: "sent"');
    expect(action).toContain('.eq("status", "draft")');
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DECLINE_REASON_REQUIRED_MESSAGE,
  declineReason,
  estimateViewLabel,
} from "@/lib/estimate-client-response";
import {
  PORTAL_DISCUSSION_MUTATION_GUC,
  evaluatePortalDirectEstimateUpdate,
  portalMayMutateEstimateField,
} from "@/lib/estimate-approval";
import { buildEstimateActionCenter } from "@/lib/record-action-center";

const sql = readFileSync(
  "supabase/migrations/0502_estimate_client_discussion.sql",
  "utf8",
);
const portalPage = readFileSync("src/app/portal/estimates/[id]/page.tsx", "utf8");
const portalActions = readFileSync("src/app/portal/actions.ts", "utf8");

const NOW = new Date("2026-09-24T15:00:00Z");

function baseEst(over: Record<string, unknown> = {}) {
  return {
    id: "est-1",
    customer_id: "cust-1",
    status: "sent",
    customer_response_note: null,
    tax_rate: 0,
    ...over,
  };
}

describe("estimate client response", () => {
  it("requires a real decline reason and labels opens", () => {
    expect(declineReason("  ")).toBeNull();
    expect(declineReason("Price")).toBe("Price");
    expect(declineReason("x".repeat(2500))?.length).toBe(2000);
    expect(estimateViewLabel(0)).toBe("Not opened");
    expect(estimateViewLabel(1)).toBe("Opened once");
    expect(estimateViewLabel(4)).toBe("Opened 4 times");
    expect(DECLINE_REASON_REQUIRED_MESSAGE).toMatch(/reason/i);
  });

  it("migration records discussion without opening commercial fields", () => {
    expect(sql).toContain("discussion_requested_at");
    expect(sql).toContain("portal_request_estimate_discussion");
    expect(sql).toContain(PORTAL_DISCUSSION_MUTATION_GUC);
    expect(sql).toContain("DECLINE_REASON_REQUIRED");
    expect(sql).toContain("Does not enable accounting");
    expect(sql).not.toMatch(/posting_enabled\s*=\s*true/i);
    const view = sql.slice(
      sql.indexOf("create or replace view public.estimates_customer"),
      sql.indexOf("comment on view public.estimates_customer"),
    );
    expect(view).not.toContain("e.target_margin");
    expect(view).not.toContain("e.notes");
    expect(view).not.toContain("commission");
    expect(view).toContain("e.discussion_requested_at");
    expect(view).toContain("e.customer_id = public.my_customer_id()");
    expect(sql).not.toMatch(/drop view[\s\S]*cascade/i);
    expect(sql).toContain(
      "grant execute on function public.portal_request_estimate_discussion(uuid, text) to authenticated",
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.portal_request_estimate_discussion\(uuid, text\) to anon/,
    );
    expect(portalMayMutateEstimateField("discussion_requested_at")).toBe(false);
    expect(portalMayMutateEstimateField("tax_rate")).toBe(false);
  });

  it("portal page offers approve, a required decline reason, and discuss", () => {
    expect(portalPage).toContain("Approve estimate");
    expect(portalPage).toContain("I want to discuss this estimate");
    expect(portalPage).toContain("portalRequestDiscussion");
    expect(portalPage).toContain("portalDeclineEstimate");
    expect(portalPage).toContain('id="decline-reason"');
    expect(portalPage).toContain("required");
    expect(portalActions).toContain("portal_request_estimate_discussion");
    expect(portalActions).toContain("DECLINE_REASON_REQUIRED_MESSAGE");
    expect(portalActions).toContain('status: "declined"');
    expect(portalActions).toContain('status: "changes_requested"');
  });

  it("blocks a decline with no reason and a direct discussion stamp", () => {
    const sent = baseEst();
    expect(
      evaluatePortalDirectEstimateUpdate({
        jwtIsServiceRole: false,
        actorRole: "customer",
        trustedApprovalMutation: false,
        old: sent,
        next: { ...sent, status: "declined", customer_response_note: "   " },
      }),
    ).toEqual({ ok: false, code: "DECLINE_REASON_REQUIRED" });
    expect(
      evaluatePortalDirectEstimateUpdate({
        jwtIsServiceRole: false,
        actorRole: "customer",
        trustedApprovalMutation: false,
        old: sent,
        next: { ...sent, status: "declined", customer_response_note: "Too high" },
      }).ok,
    ).toBe(true);
    expect(
      evaluatePortalDirectEstimateUpdate({
        jwtIsServiceRole: false,
        actorRole: "customer",
        trustedApprovalMutation: false,
        old: sent,
        next: { ...sent, discussion_requested_at: "2026-10-26T12:00:00Z" },
      }).ok,
    ).toBe(false);
    expect(
      evaluatePortalDirectEstimateUpdate({
        jwtIsServiceRole: false,
        actorRole: "customer",
        trustedApprovalMutation: false,
        trustedDiscussionMutation: true,
        old: sent,
        next: {
          ...sent,
          discussion_requested_at: "2026-10-26T12:00:00Z",
          discussion_note: "Call me",
        },
      }).ok,
    ).toBe(true);
    expect(
      evaluatePortalDirectEstimateUpdate({
        jwtIsServiceRole: false,
        actorRole: "customer",
        trustedApprovalMutation: false,
        trustedDiscussionMutation: true,
        old: sent,
        next: { ...sent, status: "declined", tax_rate: 9 },
      }).ok,
    ).toBe(false);
  });

  it("tells the office when the customer wants to discuss", () => {
    const model = buildEstimateActionCenter({
      now: NOW,
      role: "office",
      estimateId: "e",
      customerId: "c",
      status: "sent",
      sentAt: "2026-09-20T12:00:00Z",
      viewCount: 3,
      discussionRequestedAt: "2026-09-24T12:00:00Z",
      discussionNote: "The stairs",
    });
    expect(model.attention).toBe("The customer wants to discuss this estimate.");
    expect(model.situation).toContain("Opened 3 times");
    expect(model.primary).toMatchObject({ label: "Call the customer" });
    expect(model.also).toContain("The stairs");
  });
});

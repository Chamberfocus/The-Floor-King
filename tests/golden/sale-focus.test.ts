import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSaleFocus,
  chooseSaleFocus,
  type SaleCandidate,
  type SaleFocus,
} from "@/lib/sale-focus";

const NOW = new Date("2026-10-21T15:00:00Z");
const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function candidate(
  id: string,
  path: SaleFocus,
  extra: Partial<SaleCandidate> = {},
): SaleCandidate {
  return {
    id,
    name: extra.name ?? id,
    city: null,
    nextActionDue: extra.nextActionDue ?? null,
    createdAt: extra.createdAt ?? "2026-01-01T00:00:00Z",
    visitAt: extra.visitAt ?? null,
    path,
  };
}

describe("sale focus", () => {
  it("starts a customer with no visit on booking that visit", () => {
    const focus = buildSaleFocus({ customerId: CUSTOMER, now: NOW });
    expect(focus.handedOff).toBe(false);
    expect(focus.move).toMatchObject({
      step: "schedule_estimate",
      label: "Book the visit",
      href: `/customers/${CUSTOMER}?schedule=estimate`,
    });
    expect(focus.steps.map((step) => step.state)).toEqual([
      "current",
      "later",
      "later",
      "later",
      "later",
    ]);
  });

  it("keeps an upcoming visit in front of quote building", () => {
    const focus = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      visitAt: "2026-10-22T18:00:00Z",
    });
    expect(focus.move).toMatchObject({
      step: "estimate_booked",
      label: "Open the visit",
      href: `/customers/${CUSTOMER}?schedule=estimate`,
    });
    expect(focus.steps[0].state).toBe("done");
  });

  it("opens the guided quote for this customer after the visit", () => {
    const focus = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      visitAt: "2026-10-20T18:00:00Z",
    });
    expect(focus.move).toMatchObject({
      label: "Build the quote",
      href: `/estimates/guided?customer=${CUSTOMER}`,
    });
  });

  it("opens the draft quote instead of starting a second one", () => {
    const focus = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      visitAt: "2026-10-20T18:00:00Z",
      estimates: [{ id: "est-1", status: "draft", updatedAt: "2026-10-20T20:00:00Z" }],
    });
    expect(focus.move).toMatchObject({
      step: "build_quote",
      label: "Open the quote",
      href: "/estimates/est-1",
    });
  });

  it("sends a sent quote to approval and an approved quote to the deposit invoice", () => {
    const sent = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      estimates: [{ id: "est-2", status: "sent", updatedAt: "2026-10-20T20:00:00Z" }],
    });
    expect(sent.move?.href).toBe("/estimates/est-2");
    expect(sent.move?.step).toBe("approve");

    const approved = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      estimates: [{ id: "est-3", status: "approved", updatedAt: "2026-10-20T20:00:00Z" }],
    });
    expect(approved.move).toMatchObject({
      step: "collect_deposit",
      label: "Invoice the deposit",
      href: "/estimates/est-3/invoice",
    });
  });

  it("collects the deposit on the open invoice, then hands the sale to the shop", () => {
    const open = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      estimates: [{ id: "est-3", status: "approved" }],
      invoices: [{ id: "inv-1", status: "sent", estimateId: "est-3" }],
    });
    expect(open.move?.href).toBe("/invoices/inv-1");

    const paid = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      estimates: [{ id: "est-3", status: "approved" }],
      invoices: [
        {
          id: "inv-1",
          status: "sent",
          payments: [{ amount: 500, status: "active" }],
        },
      ],
    });
    expect(paid.handedOff).toBe(true);
    expect(paid.move).toBeNull();

    const ledger = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      depositOnFile: true,
      estimates: [{ id: "est-3", status: "approved" }],
    });
    expect(ledger.handedOff).toBe(true);
  });

  it("keeps a stale or changed quote on the build step", () => {
    const changed = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      estimates: [{ id: "est-4", status: "changes_requested" }],
    });
    expect(changed.move).toMatchObject({
      step: "build_quote",
      href: "/estimates/est-4",
    });
    const stale = buildSaleFocus({
      customerId: CUSTOMER,
      now: NOW,
      estimates: [{ id: "est-5", status: "approved", approvalStale: true }],
    });
    expect(stale.move?.step).toBe("build_quote");
    expect(stale.move?.href).toBe("/estimates/est-5");
  });

  it("stays with the pinned customer unless someone is being measured today", () => {
    const cold = candidate(
      CUSTOMER,
      buildSaleFocus({ customerId: CUSTOMER, now: NOW }),
    );
    const deposit = candidate(
      OTHER,
      buildSaleFocus({
        customerId: OTHER,
        now: NOW,
        estimates: [{ id: "est-9", status: "approved" }],
      }),
    );
    expect(chooseSaleFocus([cold, deposit], CUSTOMER, NOW)?.id).toBe(CUSTOMER);
    expect(chooseSaleFocus([cold, deposit], null, NOW)?.id).toBe(OTHER);

    const visitToday = candidate(
      OTHER,
      buildSaleFocus({
        customerId: OTHER,
        now: NOW,
        visitAt: "2026-10-21T18:00:00Z",
      }),
      { visitAt: "2026-10-21T18:00:00Z" },
    );
    expect(chooseSaleFocus([cold, visitToday], CUSTOMER, NOW)?.id).toBe(OTHER);

    const pinnedVisit = candidate(
      CUSTOMER,
      buildSaleFocus({
        customerId: CUSTOMER,
        now: NOW,
        visitAt: "2026-10-21T20:00:00Z",
      }),
      { visitAt: "2026-10-21T20:00:00Z" },
    );
    expect(chooseSaleFocus([pinnedVisit, visitToday], CUSTOMER, NOW)?.id).toBe(CUSTOMER);
  });

  it("leaves a finished sale and returns nothing when every sale is with the shop", () => {
    const done = candidate(
      CUSTOMER,
      buildSaleFocus({
        customerId: CUSTOMER,
        now: NOW,
        depositOnFile: true,
        estimates: [{ id: "est-3", status: "approved" }],
      }),
    );
    const open = candidate(
      OTHER,
      buildSaleFocus({ customerId: OTHER, now: NOW }),
    );
    expect(chooseSaleFocus([done, open], CUSTOMER, NOW)?.id).toBe(OTHER);
    expect(chooseSaleFocus([done], CUSTOMER, NOW)).toBeNull();
  });

  it("shows the sale on the salesman file and home, and leaves the action center as the only next-step headline", () => {
    const page = readFileSync("src/app/(app)/customers/[id]/page.tsx", "utf8");
    const home = readFileSync("src/app/(app)/home/page.tsx", "utf8");
    const root = readFileSync("src/app/page.tsx", "utf8");
    const shell = readFileSync("src/components/app-shell.tsx", "utf8");
    expect(page).toContain("SaleFocusPath");
    expect(page).toContain('profile.role === "salesman"');
    expect(page).not.toContain("Next required action");
    expect(page.indexOf("<RecordActionCenter")).toBeGreaterThan(page.indexOf("<h1"));
    expect(home).toContain('profile.role === "salesman"');
    expect(home).toContain("SaleFocusHome");
    expect(home).toContain("HomeCenterView");
    expect(root).toContain('if (profile.role === "salesman") redirect("/home")');
    expect(shell).toContain("Stay with");
    expect(shell).toContain("saleFocus");
  });
});

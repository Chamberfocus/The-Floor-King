/**
 * Production-mode reproduction (next start, post-PR #42 bundle):
 * - A null workflow_stages element throws outside the page try/catch while the
 *   app shell HTML is already rendered. The flight payload carries a numeric
 *   digest and the customer row is absent.
 * - A non-plain value rendered as a React child (customer name, company, city,
 *   phone, or lead source) throws during CustomerList / SearchPicker SSR. The
 *   flight payload again carries a numeric digest.
 *
 * Those throws are not the caught "temporarily unavailable" path. PR #42 never
 * wrapped them. The production number 2708582467 also folds in the deployment
 * path and chunk names, so this test asserts the throw itself, not that number.
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { leadSourceLabel } from "@/lib/customer-list";

const tables = new Map<string, { data: unknown; error: unknown; count?: number | null }>();

function chain(table: string) {
  const result = () => tables.get(table) ?? { data: [], error: null, count: 0 };
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const method of [
    "select", "order", "eq", "in", "or", "is", "not", "range", "limit", "gte", "lt",
  ]) {
    b[method] = self;
  }
  b.maybeSingle = async () => {
    const r = result();
    const row = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return { data: row, error: r.error };
  };
  b.single = b.maybeSingle;
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const r = result();
    return Promise.resolve({ data: r.data, error: r.error, count: r.count ?? null }).then(
      resolve,
      reject,
    );
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "admin-1" } }, error: null }),
    },
    from: (table: string) => chain(table),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    full_name: "Pat Customer",
    company: "Acme Floors",
    email: null,
    phone: "216-555-0100",
    street: "1 Main",
    city: "Cleveland",
    state: "OH",
    zip: "44101",
    stage: "new",
    source: "website",
    assigned_to: "admin-1",
    workflow_stage_id: "st-open",
    workflow_owner_id: null,
    next_action_due: null,
    cancelled_at: null,
    updated_at: "2026-09-01T12:00:00Z",
    created_at: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

const openStage = {
  id: "st-open",
  name: "New lead",
  color: "blue",
  position: 1,
  auto_action: null,
  owner_duty: null,
};
const closedStage = {
  id: "st-closed",
  name: "Closed",
  color: "zinc",
  position: 9,
  auto_action: null,
  owner_duty: null,
};

describe("Customers server render survives the digest-producing paths", () => {
  beforeEach(() => {
    tables.clear();
    tables.set("profiles", {
      data: [
        {
          id: "admin-1",
          email: "a@example.com",
          full_name: "Admin",
          phone: null,
          title: null,
          role: "admin",
          customer_id: null,
          created_at: "2026-01-01",
        },
      ],
      error: null,
    });
    tables.set("workflow_stages", { data: [openStage, closedStage], error: null });
    tables.set("scheduling_settings", {
      data: [{ id: "default", arrival_windows: "08:00-10:00" }],
      error: null,
    });
    tables.set("user_preferences", { data: null, error: null });
    tables.set("customers", { data: [customer()], error: null, count: 1 });
    for (const table of [
      "jobs",
      "appointments",
      "estimates",
      "invoices",
      "orders",
      "invoice_items",
      "payments",
      "credit_applications",
      "customer_deposit_applications",
      "invoice_write_offs",
    ]) {
      tables.set(table, { data: [], error: null });
    }
  });

  async function htmlFor(search: Record<string, unknown> = {}) {
    const { default: CustomersPage } = await import("@/app/(app)/customers/page");
    const element = await CustomersPage({ searchParams: Promise.resolve(search as never) });
    return renderToString(element);
  }

  it("a null workflow stage does not crash the page around a real customer", async () => {
    tables.set("workflow_stages", { data: [null, openStage, closedStage], error: null });
    const html = await htmlFor();
    expect(html).toContain("Pat Customer");
    expect(html).toContain("New lead");
    expect(html).not.toContain("temporarily unavailable");
    expect(html).not.toContain("No customers yet");
  });

  it("non-plain customer fields render as text instead of a React child error", async () => {
    tables.set("customers", {
      data: [
        customer({
          full_name: { label: "Pat" },
          company: { name: "Acme" },
          city: { name: "Cleveland" },
          phone: { label: "216" },
          source: { code: "web" },
        }),
      ],
      error: null,
      count: 1,
    });
    const html = await htmlFor();
    expect(html).toContain("/customers/c1");
    expect(html).not.toContain("[object Object]");
    expect(html).not.toContain("temporarily unavailable");
  });

  it("a selected stage whose name is not text does not crash the picker", async () => {
    tables.set("workflow_stages", {
      data: [{ ...openStage, name: { label: "New lead" } }, closedStage],
      error: null,
    });
    const html = await htmlFor({ stage: "st-open" });
    expect(html).toContain("Pat Customer");
    expect(html).not.toContain("[object Object]");
  });

  it("a null customer element does not hide the rest of the page", async () => {
    tables.set("customers", {
      data: [null, customer()],
      error: null,
      count: 2,
    });
    const html = await htmlFor();
    expect(html).toContain("Pat Customer");
    expect(html).not.toContain("temporarily unavailable");
  });

  it("leadSourceLabel never returns a non-string", () => {
    expect(leadSourceLabel({ code: "web" } as never)).toBe("");
    expect(leadSourceLabel("website")).toBe("Website");
  });
});

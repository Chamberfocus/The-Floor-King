import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, parseArrivalWindows } from "@/lib/format";
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
    company: null,
    email: null,
    phone: null,
    street: "1 Main",
    city: "Cleveland",
    state: "OH",
    zip: "44101",
    stage: "new",
    source: null,
    assigned_to: null,
    workflow_stage_id: "st-open",
    workflow_owner_id: null,
    next_action_due: null,
    cancelled_at: null,
    updated_at: "2026-09-01T12:00:00Z",
    created_at: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

describe("Customers page does not crash on legacy values", () => {
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
    tables.set("workflow_stages", {
      data: [
        { id: "st-open", name: "New lead", color: "blue", position: 1, auto_action: null, owner_duty: null },
        { id: "st-closed", name: "Closed", color: "zinc", position: 9, auto_action: null, owner_duty: null },
      ],
      error: null,
    });
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

  it("renders an administrator list", async () => {
    const html = await htmlFor();
    expect(html).toContain("Pat Customer");
    expect(html).not.toContain("Something went wrong");
  });

  it("repeated search params do not throw", async () => {
    const html = await htmlFor({ q: ["Pat", "other"], stage: ["st-open", "st-closed"] });
    expect(html).toContain("Customers");
    expect(html).not.toContain("No customers yet");
  });

  it("a non-string updated_at still renders that customer", async () => {
    tables.set("customers", {
      data: [customer({ updated_at: 1750000000000, source: "instagram" })],
      error: null,
      count: 1,
    });
    const html = await htmlFor();
    expect(html).toContain("Pat Customer");
    expect(html).toContain("instagram");
  });

  it("a null invoice child row does not take down the list", async () => {
    tables.set("invoices", {
      data: [
        {
          id: "inv1",
          customer_id: "c1",
          job_id: null,
          status: "sent",
          tax_rate: null,
          number: "1001",
          counter_sale: false,
        },
      ],
      error: null,
    });
    tables.set("invoice_items", { data: [null], error: null });
    tables.set("payments", { data: [null], error: null });
    const html = await htmlFor();
    expect(html).toContain("Pat Customer");
    expect(html).not.toContain("Something went wrong");
  });

  it("a failed customer query shows an error instead of an empty book", async () => {
    tables.set("customers", {
      data: null,
      error: { message: "failed to parse logic tree", code: "PGRST100" },
      count: null,
    });
    const html = await htmlFor();
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toContain("No customers yet");
  });
});

describe("legacy customer values stay renderable", () => {
  it("formats non-string timestamps without throwing", () => {
    expect(() => formatDate(1750000000000 as never)).not.toThrow();
    expect(() => formatDate(new Date("2026-01-02T00:00:00Z") as never)).not.toThrow();
    expect(formatDate("2026-01-02")).toMatch(/2026/);
    expect(formatDate(null)).toBe("");
  });

  it("ignores a non-string arrival window setting", () => {
    expect(parseArrivalWindows(["08:00-10:00"] as never).length).toBeGreaterThan(0);
  });

  it("keeps an unknown lead source as text", () => {
    expect(leadSourceLabel("instagram")).toBe("instagram");
    expect(leadSourceLabel(null)).toBe("");
    expect(leadSourceLabel("google")).toBe("Google / Search");
  });
});

/**
 * POST /customers/new — createCustomer server action.
 * The production 500 was TypeError: Cannot read properties of undefined (reading 'rest')
 * because customer_strong_identifier_taken was invoked with a detached rpc method.
 * This client copies SupabaseClient: rpc/from read this.rest, so an unbound call throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const harness = vi.hoisted(() => {
  function blankTables(): Record<string, Row[]> {
    return {
      customers: [],
      jobs: [],
      office_tasks: [],
      lead_sources: [{ id: "src-google", key: "google" }],
      customer_duplicate_overrides: [],
    };
  }

  const store = {
    role: "office" as "office" | "salesman",
    identifierTaken: false,
    seq: 0,
    tables: blankTables(),
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    reset() {
      store.role = "office";
      store.identifierTaken = false;
      store.seq = 0;
      store.tables = blankTables();
      store.rpcCalls = [];
    },
  };

  function ilikeMatch(value: unknown, pattern: string): boolean {
    const raw = String(value ?? "").toLowerCase();
    const pat = pattern.toLowerCase();
    if (!pat.includes("%")) return raw === pat;
    const parts = pat.split("%").filter((part) => part.length > 0);
    let idx = 0;
    for (const part of parts) {
      const at = raw.indexOf(part, idx);
      if (at < 0) return false;
      idx = at + part.length;
    }
    return true;
  }

  class Query implements PromiseLike<{ data: Row[] | null; error: null }> {
    private filters: Array<(row: Row) => boolean> = [];
    private op: "select" | "insert" = "select";
    private insertRow: Row | null = null;
    private limited = Number.POSITIVE_INFINITY;

    constructor(private table: string) {}

    select() {
      return this;
    }
    ilike(col: string, val: string) {
      this.filters.push((row) => ilikeMatch(row[col], val));
      return this;
    }
    eq(col: string, val: string) {
      this.filters.push((row) => row[col] === val);
      return this;
    }
    in(col: string, vals: string[]) {
      const set = new Set(vals);
      this.filters.push((row) => set.has(String(row[col] ?? "")));
      return this;
    }
    limit(n: number) {
      this.limited = n;
      return this;
    }
    insert(row: Row) {
      this.op = "insert";
      this.insertRow = row;
      return this;
    }
    maybeSingle() {
      return this.exec().then((res) => ({ data: res.data?.[0] ?? null, error: null }));
    }
    single() {
      return this.exec().then((res) => {
        const row = res.data?.[0] ?? null;
        return { data: row, error: row ? null : { message: "no row" } };
      });
    }
    then<TResult1 = { data: Row[] | null; error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { data: Row[] | null; error: null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return this.exec().then(onfulfilled, onrejected);
    }
    private exec(): Promise<{ data: Row[] | null; error: null }> {
      const table = (store.tables[this.table] ??= []);
      if (this.op === "insert" && this.insertRow) {
        const row = { id: `cust-${++store.seq}`, ...this.insertRow };
        table.push(row);
        return Promise.resolve({ data: [row], error: null });
      }
      const rows = table
        .filter((row) => this.filters.every((fn) => fn(row)))
        .slice(0, this.limited);
      return Promise.resolve({ data: rows, error: null });
    }
  }

  class BoundClient {
    rest: {
      from: (table: string) => Query;
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: boolean; error: null }>;
    };

    constructor() {
      this.rest = {
        from: (table: string) => new Query(table),
        rpc: (fn: string, args: Record<string, unknown>) => {
          store.rpcCalls.push({ fn, args });
          return Promise.resolve({ data: store.identifierTaken, error: null });
        },
      };
    }

    from(table: string) {
      return this.rest.from(table);
    }

    rpc(fn: string, args: Record<string, unknown>) {
      return this.rest.rpc(fn, args);
    }
  }

  return { store, client: new BoundClient() };
});

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/auth", () => ({
  requireProfile: async () => ({
    id: "staff-1",
    email: "office@floorking.test",
    full_name: "Office Staff",
    phone: null,
    title: null,
    role: harness.store.role,
    customer_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
  }),
  assertRole: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => harness.client,
}));

import { createCustomer, type CustomerFormState } from "@/app/(app)/customers/actions";
import { HIDDEN_DUPLICATE_MESSAGE } from "@/lib/customer-resolve";

const EMPTY: CustomerFormState = { error: null };
const SOURCE = "src-google";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function submit(fields: Record<string, string>) {
  try {
    const state = await createCustomer(EMPTY, form(fields));
    return { state };
  } catch (err) {
    const digest = err instanceof Error ? ((err as Error & { digest?: string }).digest ?? "") : "";
    if (digest.startsWith("NEXT_REDIRECT")) {
      return { redirect: digest.split(";").slice(2, -2).join(";") };
    }
    throw err;
  }
}

beforeEach(() => {
  harness.store.reset();
});

describe("POST /customers/new createCustomer", () => {
  it("throws the production TypeError when rpc is detached from the client", () => {
    const rpc = harness.client.rpc;
    expect(() =>
      rpc.call(undefined, "customer_strong_identifier_taken", {
        p_email: "ada@example.com",
        p_phone: "2165550142",
      }),
    ).toThrow(/Cannot read properties of undefined \(reading 'rest'\)/);
  });

  it("creates one customer when the form includes email and a 10-digit phone", async () => {
    const result = await submit({
      full_name: "Ada Lovelace",
      email: "Ada@Example.com",
      phone: "(216) 555-0142",
      company: "Analytical Engines",
      street: "1 Algorithm Way",
      city: "Cleveland",
      state: "OH",
      zip: "44114",
      source_id: SOURCE,
      notes: "Kitchen",
    });

    expect(result.redirect).toBe("/customers/cust-1?new=1");
    expect(harness.store.tables.customers).toHaveLength(1);
    expect(harness.store.tables.jobs).toHaveLength(0);
    expect(harness.store.tables.office_tasks).toHaveLength(0);
    expect(harness.store.rpcCalls.length).toBeGreaterThan(0);
    expect(harness.store.rpcCalls[0]).toEqual({
      fn: "customer_strong_identifier_taken",
      args: { p_email: "ada@example.com", p_phone: "2165550142" },
    });
    expect(harness.store.tables.customers[0]).toMatchObject({
      id: "cust-1",
      full_name: "Ada Lovelace",
      email: "Ada@Example.com",
      phone: "(216) 555-0142",
      company: "Analytical Engines",
      street: "1 Algorithm Way",
      city: "Cleveland",
      state: "OH",
      zip: "44114",
      source_id: SOURCE,
      source: "google",
      stage: "new",
      notes: "Kitchen",
      created_by: "staff-1",
      assigned_to: "staff-1",
    });
  });

  it("returns a validation error when the name is missing and writes nothing", async () => {
    const result = await submit({ email: "ada@example.com", phone: "2165550142", source_id: SOURCE });
    expect(result.state).toEqual({ error: "A name is required." });
    expect(harness.store.tables.customers).toHaveLength(0);
    expect(harness.store.rpcCalls).toHaveLength(0);
  });

  it("returns a validation error when the lead source is missing and writes nothing", async () => {
    const result = await submit({
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "2165550142",
    });
    expect(result.state).toEqual({ error: "Please choose where this lead came from." });
    expect(harness.store.tables.customers).toHaveLength(0);
    expect(harness.store.rpcCalls).toHaveLength(0);
  });

  it("creates a customer when optional contact fields are blank", async () => {
    const result = await submit({
      full_name: "Name Only",
      company: "",
      email: "",
      phone: "",
      street: "",
      city: "",
      state: "",
      zip: "",
      notes: "",
      source_id: SOURCE,
    });
    expect(result.redirect).toBe("/customers/cust-1?new=1");
    expect(harness.store.rpcCalls).toHaveLength(0);
    expect(harness.store.tables.customers).toHaveLength(1);
    expect(harness.store.tables.customers[0]).toMatchObject({
      full_name: "Name Only",
      company: null,
      email: null,
      phone: null,
      street: null,
      city: null,
      state: null,
      zip: null,
      notes: null,
      source_id: SOURCE,
    });
    expect(harness.store.tables.jobs).toHaveLength(0);
    expect(harness.store.tables.office_tasks).toHaveLength(0);
  });

  it("creates a customer from email alone and from phone alone", async () => {
    const byEmail = await submit({
      full_name: "Email Only",
      email: "only@example.com",
      source_id: SOURCE,
    });
    expect(byEmail.redirect).toBe("/customers/cust-1?new=1");
    expect(harness.store.rpcCalls[0]?.args).toEqual({
      p_email: "only@example.com",
      p_phone: null,
    });

    harness.store.rpcCalls = [];
    const byPhone = await submit({
      full_name: "Phone Only",
      phone: "440-555-0199",
      source_id: SOURCE,
    });
    expect(byPhone.redirect).toBe("/customers/cust-2?new=1");
    expect(harness.store.rpcCalls[0]?.args).toEqual({
      p_email: null,
      p_phone: "4405550199",
    });
    expect(harness.store.tables.customers).toHaveLength(2);
  });

  it("does not insert when email or phone already matches a customer", async () => {
    harness.store.tables.customers.push({
      id: "cust-existing",
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "2165550142",
      street: "1 Algorithm Way",
      city: "Cleveland",
      state: "OH",
      zip: "44114",
      company: null,
      assigned_to: "staff-1",
      workflow_owner_id: "staff-1",
      merged_into_customer_id: null,
    });

    const result = await submit({
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "216-555-0142",
      source_id: SOURCE,
    });

    expect(result.state?.error).toBeNull();
    expect(result.state?.duplicates?.map((row) => row.id)).toContain("cust-existing");
    expect(harness.store.tables.customers).toHaveLength(1);
    expect(harness.store.tables.jobs).toHaveLength(0);
    expect(harness.store.tables.office_tasks).toHaveLength(0);
    expect(harness.store.rpcCalls.length).toBeGreaterThan(0);
  });

  it("a retry of the same submission does not create a second customer, job, or task", async () => {
    const fields = {
      full_name: "Retry Person",
      email: "retry@example.com",
      phone: "216-555-0177",
      source_id: SOURCE,
    };
    const first = await submit(fields);
    expect(first.redirect).toBe("/customers/cust-1?new=1");

    const second = await submit(fields);
    expect(second.state?.error).toBeNull();
    expect(second.state?.duplicates?.map((row) => row.id)).toEqual(["cust-1"]);
    expect(second.redirect).toBeUndefined();
    expect(harness.store.tables.customers).toHaveLength(1);
    expect(harness.store.tables.jobs).toHaveLength(0);
    expect(harness.store.tables.office_tasks).toHaveLength(0);
  });

  it("still blocks a salesman from creating a hidden strong duplicate", async () => {
    harness.store.role = "salesman";
    harness.store.identifierTaken = true;
    harness.store.tables.customers.push({
      id: "cust-hidden",
      full_name: "Hidden Person",
      email: "hidden@example.com",
      phone: "4405551212",
      street: null,
      city: null,
      state: null,
      zip: null,
      company: null,
      assigned_to: "other-rep",
      workflow_owner_id: "other-rep",
      merged_into_customer_id: null,
    });

    const result = await submit({
      full_name: "Brand New",
      email: "hidden@example.com",
      phone: "216-555-0100",
      source_id: SOURCE,
    });

    expect(result.state).toEqual({ error: HIDDEN_DUPLICATE_MESSAGE });
    expect(harness.store.tables.customers).toHaveLength(1);
    expect(harness.store.tables.jobs).toHaveLength(0);
    expect(harness.store.tables.office_tasks).toHaveLength(0);
  });
});

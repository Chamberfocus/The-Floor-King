/**
 * Cross-workflow customer duplicate prevention.
 * Pure helpers + source wiring. No production mutation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyImportRows,
  decidePublicBooking,
  decideStaffCreate,
  filterMatchesForActor,
  findPotentialCustomerMatches,
  publicBookingResponseSafe,
  recheckBeforeInsert,
  scoreCustomerMatch,
  summarizeImport,
  type MatchableCustomer,
} from "@/lib/customer-resolve";
import { scoreCustomerDuplicate } from "@/lib/customer-duplicate";

const ROOT = join(import.meta.dirname, "../..");

const john: MatchableCustomer = {
  id: "cust-john",
  full_name: "John Smith",
  phone: "216-555-1111",
  email: "john@example.com",
  address: "123 Main St",
  city: "Cleveland",
  state: "OH",
  zip: "44101",
  assigned_to: "rep-a",
  workflow_owner_id: "rep-a",
  jobCount: 4,
};

const janeSamePhone: MatchableCustomer = {
  id: "cust-jane",
  full_name: "Jane Smith",
  phone: "(216) 555-1111",
  email: "jane@example.com",
  assigned_to: "rep-a",
  workflow_owner_id: "rep-a",
};

const otherRep: MatchableCustomer = {
  id: "cust-other",
  full_name: "Pat Lee",
  phone: "440-555-9999",
  email: "pat@example.com",
  assigned_to: "rep-b",
  workflow_owner_id: "rep-b",
};

describe("TEST 1 — New Job exact phone", () => {
  it("returns existing customer, selecting it creates no new row", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "John Smith", phone: "2165551111" },
      [john],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe("cust-john");
    expect(matches[0]!.tier).toBe("strong");
    const decided = decideStaffCreate({
      input: { fullName: "John Smith", phone: "2165551111" },
      matches,
      useExistingId: "cust-john",
      actorRole: "office",
    });
    expect(decided).toEqual({ action: "use_existing", customerId: "cust-john" });
    expect(decided.action === "create").toBe(false);
  });
});

describe("TEST 2 — Quick Estimate exact email", () => {
  it("reuses existing ID", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "J Smith", email: "JOHN@example.com" },
      [john],
    );
    expect(matches[0]!.id).toBe("cust-john");
    expect(matches[0]!.tier).toBe("strong");
    const decided = decideStaffCreate({
      input: { fullName: "J Smith", email: "JOHN@example.com" },
      matches,
      useExistingId: matches[0]!.id,
      actorRole: "office",
    });
    expect(decided.action).toBe("use_existing");
  });
});

describe("TEST 3 — Repeat C&C customer", () => {
  it("uses existing customer, no new row", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "John Smith", phone: "216-555-1111" },
      [john],
    );
    const blocked = decideStaffCreate({
      input: { fullName: "John Smith", phone: "216-555-1111" },
      matches,
      actorRole: "office",
    });
    expect(blocked.action).toBe("needs_choice");
    const reuse = decideStaffCreate({
      input: { fullName: "John Smith", phone: "216-555-1111" },
      matches,
      useExistingId: "cust-john",
      actorRole: "office",
    });
    expect(reuse).toEqual({ action: "use_existing", customerId: "cust-john" });
  });
});

describe("TEST 4 — Carry-over repeat customer", () => {
  it("does not auto-create a second UUID", () => {
    const matches = findPotentialCustomerMatches(
      {
        fullName: "John Smith",
        phone: "2165551111",
        address: "123 Main St",
        city: "Cleveland",
        state: "OH",
        zip: "44101",
      },
      [john],
    );
    const d = decideStaffCreate({
      input: { fullName: "John Smith", phone: "2165551111" },
      matches,
      actorRole: "office",
    });
    expect(d.action).toBe("needs_choice");
    if (d.action === "needs_choice") {
      expect(d.matches[0]!.id).toBe("cust-john");
    }
  });
});

describe("TEST 5 — Order approval matching contact", () => {
  it("does not blindly create when contact matches", () => {
    const matches = findPotentialCustomerMatches(
      {
        fullName: "John Smith",
        phone: "216-555-1111",
        email: "john@example.com",
      },
      [john],
    );
    const d = decideStaffCreate({
      input: {
        fullName: "John Smith",
        phone: "216-555-1111",
        email: "john@example.com",
      },
      matches,
      actorRole: "office",
    });
    expect(d.action).not.toBe("create");
    expect(d.action).toBe("needs_choice");
  });
});

describe("TEST 6 — Same name only, different contact", () => {
  it("is not auto-reused", () => {
    const other = {
      ...john,
      id: "cust-other-john",
      phone: "330-555-0000",
      email: "other@example.com",
      address: "9 Oak Rd",
    };
    const matches = findPotentialCustomerMatches(
      {
        fullName: "John Smith",
        phone: "216-555-2222",
        email: "new@example.com",
        address: "1 Pine St",
      },
      [other],
    );
    expect(matches[0]?.tier).toBe("weak");
    const d = decideStaffCreate({
      input: { fullName: "John Smith", phone: "216-555-2222" },
      matches,
      actorRole: "office",
    });
    expect(d.action).toBe("needs_choice");
    const createAnyway = decideStaffCreate({
      input: { fullName: "John Smith", phone: "216-555-2222" },
      matches,
      forceCreate: true,
      actorRole: "office",
    });
    expect(createAnyway.action).toBe("create");
  });
});

describe("TEST 7 — Spouses sharing a phone", () => {
  it("lets the user choose; no unique constraint required", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "Jane Smith", phone: "216-555-1111" },
      [john, janeSamePhone],
    );
    expect(matches.map((m) => m.id).sort()).toEqual(["cust-jane", "cust-john"]);
    const d = decideStaffCreate({
      input: { fullName: "Jane Smith", phone: "216-555-1111" },
      matches,
      actorRole: "office",
    });
    expect(d.action).toBe("needs_choice");
    if (d.action === "needs_choice") {
      expect(d.matches.length).toBeGreaterThanOrEqual(2);
    }
    const pickJane = decideStaffCreate({
      input: { fullName: "Jane Smith", phone: "216-555-1111" },
      matches,
      useExistingId: "cust-jane",
      actorRole: "office",
    });
    expect(pickJane).toEqual({
      action: "use_existing",
      customerId: "cust-jane",
    });
  });
});

describe("TEST 8–9 — Import classification", () => {
  it("TEST 8: import duplicate classified, not blindly inserted", () => {
    const classified = classifyImportRows(
      [
        {
          fullName: "John Smith",
          phone: "216-555-1111",
          email: "john@example.com",
        },
      ],
      [john],
    );
    expect(classified[0]!.class).toBe("MATCHED_EXISTING");
    expect(classified[0]!.matchedId).toBe("cust-john");
    const sum = summarizeImport(classified);
    expect(sum.new).toBe(0);
    expect(sum.matchedExisting).toBe(1);
  });

  it("TEST 9: duplicate rows inside the same batch are detected", () => {
    const classified = classifyImportRows(
      [
        { fullName: "Amy Pond", phone: "216-555-7777" },
        { fullName: "Amy Pond", phone: "216-555-7777" },
      ],
      [],
    );
    expect(classified[0]!.class).toBe("NEW");
    expect(classified[1]!.class).toBe("POSSIBLE_DUPLICATE");
    expect(classified[1]!.reason).toBe("batch");
  });
});

describe("TEST 10 — Public booking privacy", () => {
  it("auto-links exact match without leaking customer info", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "John Smith", phone: "216-555-1111" },
      [john],
    );
    const d = decidePublicBooking(matches);
    expect(d).toEqual({ action: "link_existing", customerId: "cust-john" });
    const publicBody = publicBookingResponseSafe(true);
    expect(publicBody).toEqual({ error: null, ok: true });
    expect(JSON.stringify(publicBody)).not.toContain("John");
    expect(JSON.stringify(publicBody)).not.toContain("216");
    expect(JSON.stringify(publicBody)).not.toContain("cust-john");
  });

  it("uncertain match does not auto-link", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "John Smith", phone: "216-555-0000" },
      [john],
    );
    const d = decidePublicBooking(matches);
    expect(d).toEqual({ action: "create_new", needsStaffReview: true });
    const publicBody = publicBookingResponseSafe(true);
    expect(JSON.stringify(publicBody)).not.toContain("John");
  });

  it("a truly new public booking is not flagged as a possible duplicate", () => {
    expect(decidePublicBooking([])).toEqual({
      action: "create_new",
      needsStaffReview: false,
    });
  });
});

describe("TEST 11 — Salesman ACL", () => {
  it("cannot discover a customer outside the book", () => {
    const matches = findPotentialCustomerMatches(
      { fullName: "Pat Lee", phone: "440-555-9999" },
      [otherRep],
    );
    const visible = filterMatchesForActor(matches, {
      role: "salesman",
      id: "rep-a",
    });
    expect(visible).toHaveLength(0);
    const own = filterMatchesForActor(matches, {
      role: "salesman",
      id: "rep-b",
    });
    expect(own).toHaveLength(1);
  });
});

describe("TEST 12 — Concurrent double-create recheck", () => {
  it("blocks insert when a match appears before insert", () => {
    const latest = findPotentialCustomerMatches(
      { fullName: "John Smith", phone: "216-555-1111" },
      [john],
    );
    const recheck = recheckBeforeInsert({ latest, forceCreate: false });
    expect(recheck.ok).toBe(false);
    if (!recheck.ok) expect(recheck.matches[0]!.id).toBe("cust-john");
    expect(recheckBeforeInsert({ latest, forceCreate: true }).ok).toBe(true);
    expect(recheckBeforeInsert({ latest: [], forceCreate: false }).ok).toBe(
      true,
    );
  });
});

describe("legacy scorer stays compatible", () => {
  it("email/phone still high; name-only still possible", () => {
    expect(
      scoreCustomerDuplicate(
        { fullName: "A", email: "x@y.com" },
        { id: "1", full_name: "B", email: "X@Y.com" },
      )?.confidence,
    ).toBe("high");
    expect(
      scoreCustomerDuplicate(
        { fullName: "Jane Doe" },
        { id: "1", full_name: "Jane Doe" },
      )?.confidence,
    ).toBe("possible");
    expect(
      scoreCustomerMatch(
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
      )?.reason,
    ).toBe("name_address");
  });
});

describe("workflows call the shared resolver", () => {
  const files = [
    "src/app/(app)/customers/actions.ts",
    "src/app/(app)/jobs/new/actions.ts",
    "src/app/(app)/estimates/quick/actions.ts",
    "src/app/(app)/counter-sale/actions.ts",
    "src/app/(app)/carry-over/actions.ts",
    "src/app/(app)/orders/actions.ts",
    "src/app/(app)/customers/import-actions.ts",
  ];
  for (const f of files) {
    it(`${f} uses resolveOrCreateCustomer`, () => {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("resolveOrCreateCustomer");
      expect(src).not.toMatch(
        /from\("customers"\)\s*\n\s*\.insert\(\{/,
      );
    });
  }

  it("public booking uses privacy-safe linker and does not return matches", () => {
    const src = readFileSync(join(ROOT, "src/app/book/actions.ts"), "utf8");
    expect(src).toContain("resolvePublicBookingCustomer");
    expect(src).not.toContain("matches");
    expect(src).not.toContain("full_name: name");
  });

  it("public booking rechecks immediately before insert", () => {
    const src = readFileSync(
      join(ROOT, "src/lib/data/customer-resolve.ts"),
      "utf8",
    );
    expect(src).toContain("matchOnce");
    expect(src).toContain("another request may have just inserted");
  });

  it("order approval stamps customer_id when attaching an existing match", () => {
    const src = readFileSync(
      join(ROOT, "src/app/(app)/orders/actions.ts"),
      "utf8",
    );
    expect(src).toContain("alreadyLinked");
    expect(src).toContain("useExistingId");
    expect(src).toContain("customer_id: customerId");
  });

  it("import UIs preview classification before insert", () => {
    for (const f of [
      "src/app/(app)/customers/client-importer.tsx",
      "src/app/(app)/customers/customer-mapping-importer.tsx",
    ]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src).toContain("previewImportClients");
      expect(src).toContain("ImportClassSummary");
    }
  });

  it("does not add unique(phone/email/name) constraints", () => {
    const src = readFileSync(join(ROOT, "src/lib/customer-resolve.ts"), "utf8");
    expect(src).toContain("no unique(phone/email/name) index");
  });
});

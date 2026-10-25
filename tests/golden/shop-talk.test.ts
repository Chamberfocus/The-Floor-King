/**
 * Shop talk is the shared customer thread. Office-only notes stay off it.
 * Posting does not text or email.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupShopThreads } from "@/lib/shop-talk";
import { shellSectionsForRole } from "@/lib/nav";
import type { UserRole } from "@/lib/types";

const STAFF: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
  "warehouse",
];

describe("shop talk threads", () => {
  it("keeps one row per customer and marks another person's newer note unread", () => {
    const threads = groupShopThreads(
      [
        {
          id: "old",
          customerId: "c1",
          customerName: "Smith",
          authorId: "me",
          body: "First note",
          createdAt: "2026-10-25T12:00:00Z",
        },
        {
          id: "new",
          customerId: "c1",
          customerName: "Smith",
          authorId: "warehouse",
          body: "Dye lot is short",
          createdAt: "2026-10-25T15:00:00Z",
        },
        {
          id: "other",
          customerId: "c2",
          customerName: "Jones",
          authorId: "me",
          body: "On my way",
          createdAt: "2026-10-25T14:00:00Z",
        },
      ],
      [{ customerId: "c1", readAt: "2026-10-25T13:00:00Z" }],
      "me",
    );
    expect(threads.map((thread) => thread.customerName)).toEqual(["Smith", "Jones"]);
    expect(threads[0]).toMatchObject({ preview: "Dye lot is short", unread: true });
    expect(threads[1]?.unread).toBe(false);
  });
});

describe("shop talk is on every working role's nav", () => {
  it("gives staff Shop talk and keeps it off the customer portal", () => {
    for (const role of STAFF) {
      const hrefs = shellSectionsForRole(role).flatMap((section) => section.items.map((item) => item.href));
      expect(hrefs, role).toContain("/shop-talk");
    }
    expect(shellSectionsForRole("customer")).toEqual([]);
  });
});

describe("shop talk migration and posting", () => {
  const sql = readFileSync("supabase/migrations/0497_shop_talk.sql", "utf8");
  const action = readFileSync("src/app/(app)/shop-talk/actions.ts", "utf8");
  const customerPost = readFileSync("src/app/(app)/customers/[id]/message-actions.ts", "utf8");

  it("leaves old notes office-only and opens shop messages to warehouse and crew", () => {
    expect(sql).toContain("default 'office'");
    expect(sql).toContain("audience in ('office', 'shop')");
    expect(sql).toContain("messages_warehouse_shop_read");
    expect(sql).toContain("audience = 'shop'");
    expect(sql).toContain("public.crew_sees_customer(customer_id)");
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/^\s*begin\s*;/im);
  });

  it("posts a shop message without texting or emailing", () => {
    expect(action).toContain('audience: "shop"');
    expect(action).toContain('channel: "internal"');
    expect(action).toContain("urgent: false");
    expect(action).not.toContain("sendSms");
    expect(action).not.toContain("sendEmail");
    expect(customerPost).toContain('str(formData.get("audience")) === "office" ? "office" : "shop"');
  });
});

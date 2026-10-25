/**
 * Shop talk is the shared customer thread. Office-only notes stay off it.
 * Posting does not text or email.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupShopThreads } from "@/lib/shop-talk";
import { splitShopTasks, tasksForCustomer, type ShopTaskRow } from "@/lib/shop-tasks";
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

function task(partial: Partial<ShopTaskRow> & Pick<ShopTaskRow, "id">): ShopTaskRow {
  return {
    title: partial.title ?? "Call the site",
    status: partial.status ?? "open",
    customerId: partial.customerId ?? null,
    customerName: partial.customerName ?? null,
    assignedTo: partial.assignedTo ?? null,
    assigneeName: partial.assigneeName ?? "Teammate",
    createdBy: partial.createdBy ?? null,
    senderName: partial.senderName ?? "Office",
    completedBy: partial.completedBy ?? null,
    completerName: partial.completerName ?? "",
    senderSeenAt: partial.senderSeenAt ?? null,
    ...partial,
  };
}

describe("shop talk to-dos", () => {
  it("keeps open work, sent work, and an unseen finish apart", () => {
    const lists = splitShopTasks(
      [
        task({ id: "mine", assignedTo: "me", createdBy: "office", status: "open" }),
        task({ id: "own", assignedTo: "me", createdBy: "me", status: "in_progress" }),
        task({ id: "sent", assignedTo: "crew", createdBy: "me", status: "open" }),
        task({
          id: "done",
          assignedTo: "crew",
          createdBy: "me",
          status: "completed",
          completedBy: "crew",
          completerName: "Installer",
        }),
        task({
          id: "self",
          assignedTo: "me",
          createdBy: "me",
          status: "completed",
          completedBy: "me",
        }),
        task({
          id: "seen",
          assignedTo: "crew",
          createdBy: "me",
          status: "completed",
          completedBy: "crew",
          senderSeenAt: "2026-10-25T16:00:00Z",
        }),
      ],
      "me",
    );
    expect(lists.mine.map((row) => row.id)).toEqual(["mine", "own"]);
    expect(lists.sent.map((row) => row.id)).toEqual(["sent"]);
    expect(lists.finished.map((row) => row.id)).toEqual(["done"]);
  });

  it("shows only open to-dos on that customer's thread", () => {
    const rows = tasksForCustomer(
      [
        task({ id: "open", customerId: "c1", status: "open" }),
        task({ id: "done", customerId: "c1", status: "completed" }),
        task({ id: "other", customerId: "c2", status: "open" }),
      ],
      "c1",
    );
    expect(rows.map((row) => row.id)).toEqual(["open"]);
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

  it("lets Shop talk hand off a to-do and tell the sender when it is done", () => {
    const tasksSql = readFileSync("supabase/migrations/0498_shop_talk_tasks.sql", "utf8");
    const ops = readFileSync("src/app/(app)/ops/actions.ts", "utf8");
    const board = readFileSync("src/app/(app)/shop-talk/shop-talk-board.tsx", "utf8");
    const complete = ops.slice(ops.indexOf("const TASK_COMPLETE_ROLES"), ops.indexOf("const HOLD_ROLES"));
    const assign = ops.slice(ops.indexOf("const TASK_ASSIGN_ROLES"), ops.indexOf("const TASK_COMPLETE_ROLES"));
    expect(tasksSql).toContain("sender_seen_at");
    expect(tasksSql).toContain("source = 'shop_talk'");
    expect(tasksSql).toContain("TASK_FIELD_FORBIDDEN");
    expect(tasksSql).not.toMatch(/\bdelete\s+from\b/i);
    expect(tasksSql).not.toMatch(/^\s*begin\s*;/im);
    expect(action).toContain("sendShopTask");
    expect(action).toContain('source: "shop_talk"');
    expect(action).toContain("sender_seen_at");
    expect(action).not.toContain("sendSms");
    expect(action).not.toContain("sendEmail");
    expect(complete).toContain('"crew"');
    expect(assign).not.toContain('"crew"');
    expect(assign).not.toContain('"warehouse"');
    expect(ops).toContain('task.source === "shop_talk"');
    expect(ops).toContain("Finished:");
    expect(ops).not.toContain("sendSms");
    expect(board).toContain("sendShopTask");
    expect(board).toContain("Got it");
    expect(readFileSync("src/lib/work-queues.ts", "utf8")).toContain(
      'export const TASK_LIST_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"]',
    );
  });
});

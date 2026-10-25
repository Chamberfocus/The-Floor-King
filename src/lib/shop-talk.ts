import type { UserRole } from "@/lib/types";

/** Everyone who works a job. Customers stay on the portal thread. */
export const SHOP_TALK_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
  "crew",
  "warehouse",
];

export interface ShopMessageRow {
  id: string;
  customerId: string;
  customerName: string;
  authorId: string | null;
  body: string;
  createdAt: string;
}

export interface ShopReadCursor {
  customerId: string;
  readAt: string;
}

export interface ShopThread {
  customerId: string;
  customerName: string;
  preview: string;
  at: string;
  unread: boolean;
}

/**
 * One row per customer, newest message first.
 * A message is unread when someone else wrote it after this person last opened the thread.
 */
export function groupShopThreads(
  messages: ShopMessageRow[],
  reads: ShopReadCursor[],
  userId: string,
): ShopThread[] {
  const readAt = new Map(reads.map((row) => [row.customerId, row.readAt]));
  const byCustomer = new Map<string, ShopMessageRow[]>();
  for (const message of messages) {
    const list = byCustomer.get(message.customerId) ?? [];
    list.push(message);
    byCustomer.set(message.customerId, list);
  }
  const threads: ShopThread[] = [];
  for (const [customerId, rows] of byCustomer) {
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = rows[0];
    const seen = readAt.get(customerId);
    const unread = rows.some(
      (message) => message.authorId !== userId && (!seen || message.createdAt > seen),
    );
    threads.push({
      customerId,
      customerName: latest.customerName || "Customer",
      preview: latest.body.replace(/\s+/g, " ").trim().slice(0, 120),
      at: latest.createdAt,
      unread,
    });
  }
  threads.sort(
    (a, b) => b.at.localeCompare(a.at) || a.customerName.localeCompare(b.customerName),
  );
  return threads;
}

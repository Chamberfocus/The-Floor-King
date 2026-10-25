import { createClient } from "@/lib/supabase/server";
import {
  groupShopThreads,
  SHOP_TALK_ROLES,
  type ShopMessageRow,
  type ShopReadCursor,
  type ShopThread,
} from "@/lib/shop-talk";
import type { ShopTaskRow } from "@/lib/shop-tasks";
import { ROLE_LABELS, type UserRole } from "@/lib/types";

export interface ShopCustomerHit {
  id: string;
  name: string;
  place: string;
}

export interface ShopPost {
  id: string;
  body: string;
  createdAt: string;
  authorId: string | null;
  authorName: string;
}

export interface ShopConversation {
  customerId: string;
  customerName: string;
  place: string;
  messages: ShopPost[];
}

function placeOf(street: unknown, city: unknown): string {
  return [street, city].map((part) => (typeof part === "string" ? part.trim() : "")).filter(Boolean).join(", ");
}

async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", unique);
  for (const row of data ?? []) {
    map.set(row.id as string, (row.full_name as string) || (row.email as string) || "Teammate");
  }
  return map;
}

export class ShopTalkUnavailable extends Error {
  constructor() {
    super("Shop talk is not on the database yet.");
    this.name = "ShopTalkUnavailable";
  }
}

/** Recent shared threads this person is allowed to see. */
export async function listShopThreads(userId: string): Promise<ShopThread[]> {
  const supabase = await createClient();
  const [{ data: messages, error: messageError }, { data: reads, error: readError }] = await Promise.all([
    supabase
      .from("messages")
      .select("id, customer_id, author_id, body, created_at, customers(full_name)")
      .eq("channel", "internal")
      .eq("audience", "shop")
      .order("created_at", { ascending: false })
      .limit(400),
    supabase.from("shop_talk_reads").select("customer_id, read_at").eq("user_id", userId),
  ]);
  if (messageError || readError) throw new ShopTalkUnavailable();
  const rows: ShopMessageRow[] = (messages ?? []).map((row) => {
    const customer = row.customers as { full_name?: string } | { full_name?: string }[] | null;
    const name = Array.isArray(customer) ? customer[0]?.full_name : customer?.full_name;
    return {
      id: row.id as string,
      customerId: row.customer_id as string,
      customerName: name || "Customer",
      authorId: (row.author_id as string | null) ?? null,
      body: (row.body as string) ?? "",
      createdAt: row.created_at as string,
    };
  });
  const cursors: ShopReadCursor[] = (reads ?? []).map((row) => ({
    customerId: row.customer_id as string,
    readAt: row.read_at as string,
  }));
  return groupShopThreads(rows, cursors, userId);
}

export async function searchShopCustomers(query: string): Promise<ShopCustomerHit[]> {
  const q = query.trim().replace(/[%_]/g, "").slice(0, 60);
  if (q.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, street, city")
    .ilike("full_name", `%${q}%`)
    .order("full_name", { ascending: true })
    .limit(8);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.full_name as string) || "Customer",
    place: placeOf(row.street, row.city),
  }));
}

export async function getShopConversation(customerId: string): Promise<ShopConversation | null> {
  const supabase = await createClient();
  const [{ data: customer }, { data: messages }] = await Promise.all([
    supabase.from("customers").select("id, full_name, street, city").eq("id", customerId).maybeSingle(),
    supabase
      .from("messages")
      .select("id, body, created_at, author_id")
      .eq("customer_id", customerId)
      .eq("channel", "internal")
      .eq("audience", "shop")
      .order("created_at", { ascending: true }),
  ]);
  if (!customer) return null;
  const names = await namesFor((messages ?? []).map((row) => (row.author_id as string) ?? ""));
  return {
    customerId,
    customerName: (customer.full_name as string) || "Customer",
    place: placeOf(customer.street, customer.city),
    messages: (messages ?? []).map((row) => ({
      id: row.id as string,
      body: (row.body as string) ?? "",
      createdAt: row.created_at as string,
      authorId: (row.author_id as string | null) ?? null,
      authorName: row.author_id ? (names.get(row.author_id as string) ?? "Teammate") : "System",
    })),
  };
}

/** Notes that are about the shop, not one customer. */
export async function listShopBoard(): Promise<ShopPost[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_notes")
    .select("id, body, created_at, author_id")
    .is("job_id", null)
    .is("po_id", null)
    .order("created_at", { ascending: false })
    .limit(40);
  const rows = data ?? [];
  const names = await namesFor(rows.map((row) => (row.author_id as string) ?? ""));
  return rows
    .map((row) => ({
      id: row.id as string,
      body: (row.body as string) ?? "",
      createdAt: row.created_at as string,
      authorId: (row.author_id as string | null) ?? null,
      authorName: row.author_id ? (names.get(row.author_id as string) ?? "Teammate") : "System",
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface ShopPerson {
  id: string;
  name: string;
  roleLabel: string;
}

/** People a to-do can be sent to. */
export async function listShopPeople(): Promise<ShopPerson[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .in("role", SHOP_TALK_ROLES as unknown as string[])
    .order("full_name", { ascending: true });
  return (data ?? []).map((row) => {
    const role = row.role as UserRole;
    return {
      id: row.id as string,
      name: (row.full_name as string) || (row.email as string) || "Teammate",
      roleLabel: ROLE_LABELS[role] ?? role,
    };
  });
}

/**
 * Tasks this person was given or sent. Missing the new column means the
 * to-do migration has not been run; the caller keeps the threads up.
 */
export async function listShopTasks(userId: string): Promise<{ tasks: ShopTaskRow[]; missing: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("office_tasks")
    .select(
      "id, title, status, customer_id, assigned_to, created_by, completed_by, sender_seen_at, customers(full_name)",
    )
    .or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) return { tasks: [], missing: true };
  const rows = data ?? [];
  const ids = rows.flatMap((row) => [row.assigned_to, row.created_by, row.completed_by].filter(Boolean) as string[]);
  const names = await namesFor(ids);
  const tasks: ShopTaskRow[] = rows.map((row) => {
    const customer = row.customers as { full_name?: string } | { full_name?: string }[] | null;
    const customerName = Array.isArray(customer) ? customer[0]?.full_name : customer?.full_name;
    const assignedTo = (row.assigned_to as string | null) ?? null;
    const createdBy = (row.created_by as string | null) ?? null;
    const completedBy = (row.completed_by as string | null) ?? null;
    return {
      id: row.id as string,
      title: (row.title as string) ?? "",
      status: (row.status as string) ?? "open",
      customerId: (row.customer_id as string | null) ?? null,
      customerName: customerName ?? null,
      assignedTo,
      assigneeName: assignedTo ? (names.get(assignedTo) ?? "Teammate") : "Unassigned",
      createdBy,
      senderName: createdBy ? (names.get(createdBy) ?? "Teammate") : "Shop",
      completedBy,
      completerName: completedBy ? (names.get(completedBy) ?? "Teammate") : "",
      senderSeenAt: (row.sender_seen_at as string | null) ?? null,
    };
  });
  return { tasks, missing: false };
}

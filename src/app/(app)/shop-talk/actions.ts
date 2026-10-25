"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { refuseNewActiveWorkForCustomer } from "@/lib/active-work-guard";
import { SHOP_TALK_ROLES } from "@/lib/shop-talk";
import type { UserRole } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

export interface ShopTalkState {
  error: string | null;
  ok?: boolean;
}

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Shared customer thread. Never emails and never texts. */
export async function postShopMessage(
  _prev: ShopTalkState,
  formData: FormData,
): Promise<ShopTalkState> {
  const profile = await assertRole(SHOP_TALK_ROLES);
  const customerId = str(formData.get("customer_id"));
  const body = str(formData.get("body")).slice(0, 4000);
  if (!customerId) return { error: "Pick a customer first." };
  if (!body) return { error: "Write a message first." };

  const supabase = await createClient();
  const { error } = await supabase.from("messages").insert({
    customer_id: customerId,
    channel: "internal",
    audience: "shop",
    author_id: profile.id,
    body,
  });
  if (error) {
    console.error("[postShopMessage]", error.code);
    return { error: "That message could not be saved. Refresh and try again." };
  }
  revalidatePath("/shop-talk");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

/** A note for the whole shop, not one customer. Stays on this page. */
export async function postShopBoard(
  _prev: ShopTalkState,
  formData: FormData,
): Promise<ShopTalkState> {
  const profile = await assertRole(SHOP_TALK_ROLES);
  const body = str(formData.get("body")).slice(0, 4000);
  if (!body) return { error: "Write a message first." };

  const supabase = await createClient();
  const { error } = await supabase.from("work_notes").insert({
    job_id: null,
    po_id: null,
    body,
    on_work_order: false,
    for_warehouse: false,
    urgent: false,
    author_id: profile.id,
  });
  if (error) {
    console.error("[postShopBoard]", error.code);
    return { error: "That message could not be saved. Refresh and try again." };
  }
  revalidatePath("/shop-talk");
  return { error: null, ok: true };
}

/**
 * Hand a to-do to someone on the team.
 * A customer is optional. Nothing here texts or emails.
 */
export async function sendShopTask(
  _prev: ShopTalkState,
  formData: FormData,
): Promise<ShopTalkState> {
  const profile = await assertRole(SHOP_TALK_ROLES);
  const title = str(formData.get("title")).slice(0, 200);
  const assignedTo = str(formData.get("assigned_to"));
  const skipCustomer = formData.get("no_customer") === "1" || formData.get("no_customer") === "on";
  const customerId = skipCustomer ? "" : str(formData.get("customer_id"));
  if (!title) return { error: "Write what needs done." };
  if (!assignedTo) return { error: "Pick who should do it." };

  const supabase = await createClient();
  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", assignedTo)
    .maybeSingle();
  const role = person?.role as UserRole | undefined;
  if (!person || !role || !SHOP_TALK_ROLES.includes(role)) {
    return { error: "Pick someone on the team." };
  }
  const assigneeName =
    (person.full_name as string) || (person.email as string) || "Teammate";

  if (customerId) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (!customer) return { error: "That customer is not on your list." };
    const blocked = await refuseNewActiveWorkForCustomer(supabase, customerId);
    if (blocked) return { error: blocked };
  }

  const { error } = await supabase.from("office_tasks").insert({
    title,
    assigned_to: assignedTo,
    created_by: profile.id,
    customer_id: customerId || null,
    source: "shop_talk",
    status: "open",
    priority: "normal",
  });
  if (error) {
    console.error("[sendShopTask]", error.code);
    return { error: "That to-do could not be sent. Refresh and try again." };
  }

  if (customerId) {
    const { error: noteError } = await supabase.from("messages").insert({
      customer_id: customerId,
      channel: "internal",
      audience: "shop",
      author_id: profile.id,
      body: `To-do for ${assigneeName}: ${title}`.slice(0, 4000),
    });
    if (noteError) console.error("[sendShopTask note]", noteError.code);
  }

  revalidatePath("/shop-talk");
  revalidatePath("/tasks");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

/** The sender has seen that their to-do was finished. */
export async function ackShopTask(
  _prev: ShopTalkState,
  formData: FormData,
): Promise<ShopTalkState> {
  const profile = await assertRole(SHOP_TALK_ROLES);
  const id = str(formData.get("task_id"));
  if (!id) return { error: "That notice is gone. Refresh and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("office_tasks")
    .update({
      sender_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("created_by", profile.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[ackShopTask]", error.code);
    return { error: "That notice could not be cleared. Refresh and try again." };
  }
  if (!data) return { error: "That notice is gone. Refresh and try again." };
  revalidatePath("/shop-talk");
  return { error: null, ok: true };
}

export async function markShopTalkRead(customerId: string): Promise<void> {
  const profile = await assertRole(SHOP_TALK_ROLES);
  if (!customerId) return;
  const supabase = await createClient();
  await supabase.from("shop_talk_reads").upsert({
    user_id: profile.id,
    customer_id: customerId,
    read_at: new Date().toISOString(),
  });
}

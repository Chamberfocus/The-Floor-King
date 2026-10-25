"use server";

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { SHOP_TALK_ROLES } from "@/lib/shop-talk";
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

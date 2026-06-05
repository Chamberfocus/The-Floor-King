"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { MessageChannel } from "@/lib/types";

export interface MessageFormState {
  error: string | null;
  ok?: boolean;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function postMessage(
  _prev: MessageFormState,
  formData: FormData,
): Promise<MessageFormState> {
  const customerId = str(formData.get("customer_id"));
  const channel = str(formData.get("channel")) as MessageChannel;
  const body = str(formData.get("body"));
  if (!customerId || (channel !== "internal" && channel !== "client")) {
    return { error: "Missing message info." };
  }
  if (!body) return { error: "Write a message first." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("messages").insert({
    customer_id: customerId,
    channel,
    author_id: user?.id ?? null,
    body,
  });
  if (error) return { error: error.message };

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

import { createClient } from "@/lib/supabase/server";
import type { Message, MessageWithAuthor } from "@/lib/types";

/** Staff view: all messages for a customer, with author names resolved. */
export async function listCustomerMessages(
  customerId: string,
): Promise<MessageWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  const msgs = (data ?? []) as Message[];

  const ids = [...new Set(msgs.map((m) => m.author_id).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", ids);
    for (const p of profs ?? []) {
      nameById.set(
        p.id as string,
        (p.full_name as string) || (p.email as string),
      );
    }
  }
  return msgs.map((m) => ({
    ...m,
    author_name: m.author_id ? (nameById.get(m.author_id) ?? "Teammate") : "System",
  }));
}

/** Portal view: the client-channel thread only (RLS already restricts). */
export async function listClientThread(customerId: string): Promise<Message[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  return (data ?? []) as Message[];
}

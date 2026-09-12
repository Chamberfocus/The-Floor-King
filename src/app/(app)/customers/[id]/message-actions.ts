"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import type { MessageChannel } from "@/lib/types";
import type { MessageSendResult } from "@/lib/message-send";

export interface MessageFormState {
  error: string | null;
  ok?: boolean;
  notify?: MessageSendResult | null;
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

  let notify: MessageSendResult | null = null;
  if (channel === "client" && str(formData.get("send_email")) !== "no") {
    const { data: cust } = await supabase
      .from("customers")
      .select("full_name, email")
      .eq("id", customerId)
      .maybeSingle();
    const email = (cust?.email as string | null) ?? null;
    if (!email) {
      notify = { status: "not_attempted", reason: "No email address on file." };
    } else {
      const first = (cust?.full_name as string | null)?.split(" ")[0] ?? "there";
      notify = await sendEmail({
        to: email,
        subject: "A new message from Cleveland Floor King",
        html: emailLayout(
          "You have a new message",
          `<p>Hi ${first},</p>
           <p>You have a new message from our team:</p>
           <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #123a63;background:#eef4fb;border-radius:8px;color:#374151;white-space:pre-wrap;">${body.replace(/</g, "&lt;")}</blockquote>
           <p>Reply right here in your project portal and we'll get back to you.</p>`,
          { label: "Open your project", url: `${siteUrl()}/portal` },
          { preheader: body.slice(0, 120) },
        ),
      });
    }
  }

  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true, notify };
}

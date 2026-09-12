"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { getDriveTime } from "@/lib/maps";
import {
  combineMessageSends,
  type MessageSendResult,
} from "@/lib/message-send";

export async function notifyOnTheWay(
  customerId: string,
  /** false → skip the email + text (still drops the note in their portal). */
  alsoEmail = true,
): Promise<{ error: string | null; eta?: string; notify: MessageSendResult }> {
  if (!customerId) {
    return {
      error: "Missing customer.",
      notify: { status: "not_attempted", reason: "Missing customer." },
    };
  }
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("customers")
    .select("full_name, email, phone, street, city, state, zip")
    .eq("id", customerId)
    .maybeSingle();
  if (!c) {
    return {
      error: "Customer not found.",
      notify: { status: "not_attempted", reason: "Customer not found." },
    };
  }

  const dest = [c.street, c.city, c.state, c.zip].filter(Boolean).join(", ");
  const eta = await getDriveTime(dest);
  const etaText = eta?.text ?? null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let notify: MessageSendResult = {
    status: "not_attempted",
    reason: "Posted to their portal only.",
  };
  if (alsoEmail) {
    const sends: MessageSendResult[] = [];
    if (c.email) {
      sends.push(
        await sendEmail({
          to: c.email as string,
          subject: "Your Cleveland Floor King team is on the way 🚚",
          html: emailLayout(
            "We're on our way!",
            `<p>Hi ${(c.full_name as string)?.split(" ")[0] ?? "there"},</p>
         <p>Your Cleveland Floor King team is headed your way${etaText ? ` — estimated arrival in about <strong>${etaText}</strong>` : ""}. See you soon!</p>`,
            { label: "View your project", url: `${siteUrl()}/portal` },
          ),
        }),
      );
    } else {
      sends.push({ status: "not_attempted", reason: "No email address on file." });
    }
    if (c.phone) {
      sends.push(
        await sendSms(
          c.phone as string,
          `Cleveland Floor King is on the way${etaText ? ` — ETA about ${etaText}` : ""}. See you soon!`,
        ),
      );
    } else {
      sends.push({ status: "not_attempted", reason: "No phone number on file." });
    }
    notify = combineMessageSends(sends);
  }

  // Also drop it in the customer chat so it shows in their portal.
  await supabase.from("messages").insert({
    customer_id: customerId,
    channel: "client",
    author_id: user?.id ?? null,
    body: `🚚 We're on our way${etaText ? ` — ETA about ${etaText}` : ""}.`,
  });

  revalidatePath(`/customers/${customerId}`);
  return { error: null, eta: etaText ?? undefined, notify };
}

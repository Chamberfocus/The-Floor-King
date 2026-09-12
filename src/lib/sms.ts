/**
 * Text messaging. SERVER ONLY.
 * Missing provider config or gated-off notify is NOT ATTEMPTED, not success.
 */
import type { MessageSendResult } from "@/lib/message-send";

/** Normalize a US number to E.164 (+1XXXXXXXXXX). Returns null if unusable. */
function toE164(to: string): string | null {
  let d = to.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function sendSms(to: string, body: string): Promise<MessageSendResult> {
  if (!to) {
    return { status: "not_attempted", reason: "No phone number." };
  }

  const telnyxKey = process.env.TELNYX_API_KEY;
  const telnyxFrom = process.env.TELNYX_FROM;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioFrom = process.env.TWILIO_FROM;

  const useTelnyx = !!(telnyxKey && telnyxFrom);
  const useTwilio = !useTelnyx && !!(twilioSid && twilioFrom);
  if (!useTelnyx && !useTwilio) {
    return {
      status: "not_attempted",
      reason: "Text messaging is not configured.",
    };
  }

  const { notifyAllowed } = await import("@/lib/notify-gate");
  if (!(await notifyAllowed({ phone: to }))) {
    return {
      status: "not_attempted",
      reason: "Customer text notifications are turned off.",
    };
  }

  const dest = toE164(to);
  if (!dest) {
    return { status: "not_attempted", reason: "Phone number is not a usable US number." };
  }

  try {
    if (useTelnyx) {
      const profileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
      const res = await fetch("https://api.telnyx.com/v2/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${telnyxKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: telnyxFrom,
          to: dest,
          text: body,
          ...(profileId ? { messaging_profile_id: profileId } : {}),
        }),
      });
      if (res.ok) return { status: "success" };
      return {
        status: "failed",
        error: `Text provider rejected the send (${res.status}).`,
      };
    }

    const authUser = process.env.TWILIO_API_KEY_SID || twilioSid;
    const authPass =
      process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
    if (!authUser || !authPass) {
      return {
        status: "not_attempted",
        reason: "Text messaging is not configured.",
      };
    }
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: dest,
          From: twilioFrom as string,
          Body: body,
        }).toString(),
      },
    );
    if (res.ok) return { status: "success" };
    return {
      status: "failed",
      error: `Text provider rejected the send (${res.status}).`,
    };
  } catch (e) {
    return {
      status: "failed",
      error: e instanceof Error ? e.message : "Text send failed.",
    };
  }
}

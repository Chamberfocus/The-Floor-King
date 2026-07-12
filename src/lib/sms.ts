/**
 * Text messaging. SERVER ONLY.
 * Primary provider is Telnyx (API v2): set TELNYX_API_KEY + TELNYX_FROM (and
 * optionally TELNYX_MESSAGING_PROFILE_ID). Falls back to Twilio if only the
 * Twilio vars are set. No-ops (returns false) until one provider is configured,
 * so it's safe to call anywhere.
 */

/** Normalize a US number to E.164 (+1XXXXXXXXXX). Returns null if unusable. */
function toE164(to: string): string | null {
  let d = to.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!to) return false;

  const telnyxKey = process.env.TELNYX_API_KEY;
  const telnyxFrom = process.env.TELNYX_FROM;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioFrom = process.env.TWILIO_FROM;

  const useTelnyx = !!(telnyxKey && telnyxFrom);
  const useTwilio = !useTelnyx && !!(twilioSid && twilioFrom);
  if (!useTelnyx && !useTwilio) return false;

  // Master switches: never text a customer while customer notifications are off.
  const { notifyAllowed } = await import("@/lib/notify-gate");
  if (!(await notifyAllowed({ phone: to }))) return false;

  const dest = toE164(to);
  if (!dest) return false;

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
      return res.ok;
    }

    // Twilio fallback (API Key auth if present, else Account Auth Token).
    const authUser = process.env.TWILIO_API_KEY_SID || twilioSid;
    const authPass =
      process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
    if (!authUser || !authPass) return false;
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
    return res.ok;
  } catch {
    return false;
  }
}

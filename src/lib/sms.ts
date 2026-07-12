/**
 * Text messaging via Twilio. SERVER ONLY.
 * Auth uses an API Key (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET) when set —
 * the secure, revocable method — otherwise falls back to the Account Auth Token
 * (TWILIO_AUTH_TOKEN). Either way TWILIO_ACCOUNT_SID (the AC… id) and TWILIO_FROM
 * (the sending number) are required. No-ops (returns false) until configured, so
 * it's safe to call anywhere.
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID; // AC… — the account (URL path)
  const from = process.env.TWILIO_FROM;
  // Prefer API Key auth; fall back to Account SID + Auth Token.
  const authUser = process.env.TWILIO_API_KEY_SID || accountSid;
  const authPass = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authUser || !authPass || !from || !to) return false;
  // Master switches: never text a customer while customer notifications are off.
  const { notifyAllowed } = await import("@/lib/notify-gate");
  if (!(await notifyAllowed({ phone: to }))) return false;

  // Normalize to E.164-ish (US default) if a bare 10-digit number is given.
  let dest = to.replace(/[^\d+]/g, "");
  if (!dest.startsWith("+")) {
    if (dest.length === 10) dest = `+1${dest}`;
    else if (dest.length === 11 && dest.startsWith("1")) dest = `+${dest}`;
    else return false;
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${authUser}:${authPass}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: dest, From: from, Body: body }).toString(),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

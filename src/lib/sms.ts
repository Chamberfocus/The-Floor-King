/**
 * Text messaging via Twilio. SERVER ONLY.
 * No-ops (returns false) until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
 * TWILIO_FROM are set, so it's safe to call anywhere.
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from || !to) return false;

  // Normalize to E.164-ish (US default) if a bare 10-digit number is given.
  let dest = to.replace(/[^\d+]/g, "");
  if (!dest.startsWith("+")) {
    if (dest.length === 10) dest = `+1${dest}`;
    else if (dest.length === 11 && dest.startsWith("1")) dest = `+${dest}`;
    else return false;
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
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

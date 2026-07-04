import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCode,
  emailFromIdToken,
  googleConfigured,
} from "@/lib/google-calendar";
import { saveGoogleConnection } from "@/lib/data/google-calendar";
import { siteUrl } from "@/lib/notify";

/** Google redirects here after consent — exchange the code, store tokens. */
export async function GET(req: Request) {
  const base = siteUrl();
  const settings = `${base}/settings/preferences`;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (!googleConfigured())
    return NextResponse.redirect(`${settings}?gcal=notconfigured`);
  if (err || !code) return NextResponse.redirect(`${settings}?gcal=denied`);

  const cookieStore = await cookies();
  const expected = cookieStore.get("g_oauth_state")?.value;
  if (!expected || expected !== state)
    return NextResponse.redirect(`${settings}?gcal=state`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  try {
    const tokens = await exchangeCode(code);
    const email = emailFromIdToken(tokens.id_token);
    await saveGoogleConnection(user.id, tokens, email);
  } catch {
    return NextResponse.redirect(`${settings}?gcal=error`);
  }

  const res = NextResponse.redirect(`${settings}?gcal=connected`);
  res.cookies.delete("g_oauth_state");
  return res;
}

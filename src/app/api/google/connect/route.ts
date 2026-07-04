import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { googleConfigured, buildAuthUrl } from "@/lib/google-calendar";
import { siteUrl } from "@/lib/notify";

/** Kick off the Google OAuth consent flow for the signed-in user. */
export async function GET() {
  const base = siteUrl();
  const settings = `${base}/settings/preferences`;
  if (!googleConfigured())
    return NextResponse.redirect(`${settings}?gcal=notconfigured`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${base}/login`);

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(state));
  // CSRF guard — verified against the `state` Google echoes back.
  res.cookies.set("g_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Reports which env vars the live server can see (booleans only — no secrets). */
export async function GET() {
  const present = (v?: string) => Boolean(v && v.trim().length > 0);
  return NextResponse.json({
    anthropic: present(process.env.ANTHROPIC_API_KEY),
    resend: present(process.env.RESEND_API_KEY),
    supabaseService: present(process.env.SUPABASE_SERVICE_ROLE_KEY),
    googleMapsServer: present(process.env.GOOGLE_MAPS_API_KEY),
    googleMapsPublic: present(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY),
    cronSecret: present(process.env.CRON_SECRET),
    twilio: present(process.env.TWILIO_ACCOUNT_SID),
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });
}

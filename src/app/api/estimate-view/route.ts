import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * The customer actually loaded the estimate page.
 *
 * This is the number worth trusting. An email "open" is a tracking pixel:
 * Apple Mail Privacy Protection fetches it whether or not a human looked, and
 * Gmail caches it so the second and third reads never register. A page load is
 * a person.
 *
 * Fired by the portal page on mount. Unauthenticated by necessity — the
 * customer is following an emailed link — so it is deliberately narrow: it can
 * only ever append a 'viewed' row for an estimate that already exists, and it
 * returns the same answer either way so it can't be used to probe for valid ids.
 */

/** Repeat loads inside this window are the same sitting — a refresh, a back
 *  button, a second tab. Counting those would turn one read into five. */
const SAME_SITTING_MINUTES = 30;

export async function POST(request: NextRequest) {
  let body: { estimateId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const estimateId = (body.estimateId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(estimateId)) return NextResponse.json({ ok: true });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const { data: est } = await admin
    .from("estimates")
    .select("id, sent_at")
    .eq("id", estimateId)
    .maybeSingle();
  // Never count a view before it was sent — that's us building it, not them.
  if (!est?.sent_at) return NextResponse.json({ ok: true });

  const since = new Date(Date.now() - SAME_SITTING_MINUTES * 60_000).toISOString();
  const { data: recent } = await admin
    .from("estimate_events")
    .select("id")
    .eq("estimate_id", estimateId)
    .eq("kind", "viewed")
    .gte("at", since)
    .limit(1);
  if (recent?.length) return NextResponse.json({ ok: true, sameSitting: true });

  await admin.from("estimate_events").insert({
    estimate_id: estimateId,
    kind: "viewed",
    at: new Date().toISOString(),
    meta: {
      source: "portal",
      ua: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    },
  });

  return NextResponse.json({ ok: true });
}

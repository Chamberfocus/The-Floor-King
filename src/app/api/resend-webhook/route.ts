import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Resend webhook → when a customer OPENS an estimate email, alert the owner once.
 * Configure the Resend endpoint as: /api/resend-webhook?key=RESEND_WEBHOOK_SECRET
 * (estimate emails are tagged with estimate_id so we can attribute the open).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret && request.nextUrl.searchParams.get("key") !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: { type?: string; data?: { tags?: unknown } };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false });
  }
  if (payload?.type !== "email.opened") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const tags = payload.data?.tags;
  let estimateId: string | null = null;
  if (Array.isArray(tags)) {
    const t = tags.find(
      (x): x is { name: string; value: string } =>
        !!x && typeof x === "object" && (x as { name?: string }).name === "estimate_id",
    );
    estimateId = t?.value ?? null;
  } else if (tags && typeof tags === "object") {
    estimateId = (tags as Record<string, string>).estimate_id ?? null;
  }
  if (!estimateId) return NextResponse.json({ ok: true, noTag: true });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false });
  }

  const { data: est } = await admin
    .from("estimates")
    .select("id, title, viewed_at, customer:customers(full_name)")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est || est.viewed_at) return NextResponse.json({ ok: true, already: true });

  await admin
    .from("estimates")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", estimateId);

  const cust = est.customer as unknown as { full_name: string | null } | null;
  await sendEmail({
    to: ownerEmail(),
    subject: `Customer opened the estimate — ${cust?.full_name ?? ""}`.trim(),
    html: emailLayout(
      "Customer opened your estimate 👀",
      `<p>${cust?.full_name ?? "Your customer"} just opened estimate${est.title ? ` "${est.title}"` : ""}.</p>`,
      { label: "Open estimate", url: `${siteUrl()}/estimates/${estimateId}` },
    ),
  });

  return NextResponse.json({ ok: true });
}

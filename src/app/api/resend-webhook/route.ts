import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * Resend webhook → the delivery story for an estimate email.
 *
 * Configure the Resend endpoint as: /api/resend-webhook?key=RESEND_WEBHOOK_SECRET
 * and subscribe it to every email.* event (estimate emails carry an estimate_id
 * tag so we can attribute them).
 *
 * This used to listen for "opened" alone and record only the first one, so
 * "delivered?" and "how many times?" were unanswerable. Every event is now
 * stored; the counts are derived from that log, not incremented in place.
 */

/** Resend event name → our event kind. Anything unlisted is ignored. */
const KIND: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "email_opened",
  "email.clicked": "link_clicked",
};

function tagValue(tags: unknown, name: string): string | null {
  if (Array.isArray(tags)) {
    const t = tags.find(
      (x): x is { name: string; value: string } =>
        !!x && typeof x === "object" && (x as { name?: string }).name === name,
    );
    return t?.value ?? null;
  }
  if (tags && typeof tags === "object") {
    return (tags as Record<string, string>)[name] ?? null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret && request.nextUrl.searchParams.get("key") !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: {
    type?: string;
    created_at?: string;
    data?: { tags?: unknown; to?: unknown; created_at?: string };
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false });
  }

  const kind = KIND[payload?.type ?? ""];
  if (!kind) return NextResponse.json({ ok: true, ignored: payload?.type });

  const estimateId = tagValue(payload.data?.tags, "estimate_id");
  if (!estimateId) return NextResponse.json({ ok: true, noTag: true });

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false });
  }

  const to = payload.data?.to;
  const recipient = Array.isArray(to) ? String(to[0] ?? "") : to ? String(to) : null;
  // The provider's own timestamp, so a retried or delayed webhook lands at the
  // moment the thing happened rather than the moment we heard about it.
  const at = payload.data?.created_at ?? payload.created_at ?? new Date().toISOString();

  // Duplicate deliveries of the same webhook are normal; the unique index on
  // (estimate_id, kind, at) makes a retry a no-op instead of another "open".
  const { error } = await admin.from("estimate_events").insert({
    estimate_id: estimateId,
    kind,
    at,
    recipient,
    meta: { provider: "resend", type: payload.type },
  });
  const duplicate = error?.code === "23505";
  if (error && !duplicate) {
    console.error("[resend-webhook]", error.code, error.message);
    return NextResponse.json({ ok: false });
  }
  if (duplicate) return NextResponse.json({ ok: true, duplicate: true });

  // Keep the legacy first-open stamp in step for anything still reading it.
  if (kind === "email_opened") {
    await admin
      .from("estimates")
      .update({ viewed_at: at })
      .eq("id", estimateId)
      .is("viewed_at", null);
  }

  // Tell the owner the things that need a human: it bounced, or they read it.
  if (kind === "bounced" || kind === "complained" || kind === "email_opened") {
    await alertOwner(admin, estimateId, kind, recipient);
  }

  return NextResponse.json({ ok: true, kind });
}

/** One email to the owner — but only the first time, so a customer re-reading
 *  the quote five times doesn't mean five notifications. */
async function alertOwner(
  admin: ReturnType<typeof createAdminClient>,
  estimateId: string,
  kind: string,
  recipient: string | null,
) {
  const { count } = await admin
    .from("estimate_events")
    .select("id", { count: "exact", head: true })
    .eq("estimate_id", estimateId)
    .eq("kind", kind);
  if ((count ?? 0) > 1) return;

  const { data: est } = await admin
    .from("estimates")
    .select("id, title, customer:customers(full_name)")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return;
  const cust = est.customer as unknown as { full_name: string | null } | null;
  const who = cust?.full_name ?? "Your customer";
  const which = est.title ? ` "${est.title}"` : "";

  const copy: Record<string, { subject: string; heading: string; body: string }> = {
    email_opened: {
      subject: `Customer opened the estimate — ${who}`,
      heading: "Customer opened your estimate 👀",
      body: `<p>${who} just opened estimate${which}.</p>`,
    },
    bounced: {
      subject: `Estimate did NOT reach ${who}`,
      heading: "That estimate bounced ⚠️",
      body: `<p>The estimate${which} never reached ${who}${
        recipient ? ` at ${recipient}` : ""
      }. Their mail server rejected it — check the address before you chase them for an answer.</p>`,
    },
    complained: {
      subject: `${who} marked the estimate as spam`,
      heading: "Marked as spam ⚠️",
      body: `<p>${who} marked the estimate${which} as spam. Don't email that address again — call instead.</p>`,
    },
  };
  const c = copy[kind];
  if (!c) return;

  await sendEmail({
    to: ownerEmail(),
    subject: c.subject,
    html: emailLayout(c.heading, c.body, {
      label: "Open estimate",
      url: `${siteUrl()}/estimates/${estimateId}`,
    }),
  });
}

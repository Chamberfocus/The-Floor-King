import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Telnyx messaging webhook. Telnyx POSTs delivery receipts (message.sent /
 * message.finalized) and inbound texts (message.received) here. We accept
 * everything and 200 so Telnyx is happy; inbound-reply-to-CRM can be layered on
 * later. A GET returns ok so the URL verifies in the portal.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      data?: { event_type?: string; payload?: Record<string, unknown> };
    };
    const type = payload?.data?.event_type ?? "unknown";
    // Minimal, safe handling: acknowledge. (Delivery status + inbound routing
    // to the customer message thread can be added here without changing the URL.)
    void type;
  } catch {
    /* ignore malformed bodies */
  }
  return NextResponse.json({ ok: true });
}

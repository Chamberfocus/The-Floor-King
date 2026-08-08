import { createClient } from "@/lib/supabase/server";
import type { EstimateDelivery } from "@/components/estimate-delivery-card";

const EMPTY = (sentAt: string | null): EstimateDelivery => ({
  sent_at: sentAt,
  delivered_at: null,
  bounced_at: null,
  complained_at: null,
  view_count: 0,
  first_viewed_at: null,
  last_viewed_at: null,
  email_open_count: 0,
  last_email_open_at: null,
  click_count: 0,
});

/**
 * Did the estimate land, and did they read it — read from the derived view, so
 * the counts are always the event log's own answer and can never drift from it.
 */
export async function getEstimateDelivery(
  estimateId: string,
): Promise<EstimateDelivery> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("estimate_delivery")
    .select(
      "sent_at, delivered_at, bounced_at, complained_at, view_count, first_viewed_at, last_viewed_at, email_open_count, last_email_open_at, click_count",
    )
    .eq("estimate_id", estimateId)
    .maybeSingle();

  if (error || !data) {
    // Before the migration runs, fall back to the estimate's own sent stamp so
    // the page still renders rather than blowing up on a missing view.
    const { data: est } = await supabase
      .from("estimates")
      .select("sent_at")
      .eq("id", estimateId)
      .maybeSingle();
    return EMPTY((est?.sent_at as string) ?? null);
  }

  return {
    sent_at: (data.sent_at as string) ?? null,
    delivered_at: (data.delivered_at as string) ?? null,
    bounced_at: (data.bounced_at as string) ?? null,
    complained_at: (data.complained_at as string) ?? null,
    view_count: Number(data.view_count ?? 0),
    first_viewed_at: (data.first_viewed_at as string) ?? null,
    last_viewed_at: (data.last_viewed_at as string) ?? null,
    email_open_count: Number(data.email_open_count ?? 0),
    last_email_open_at: (data.last_email_open_at as string) ?? null,
    click_count: Number(data.click_count ?? 0),
  };
}

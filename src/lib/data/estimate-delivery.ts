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

export interface EstimateClientSignal {
  view_count: number;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  discussion_requested_at: string | null;
  discussion_note: string | null;
}

/**
 * Opens and discussion requests for a page of estimates.
 * Each half fails soft so a list still renders before 0139 or 0502 is applied.
 */
export async function listEstimateClientSignals(estimateIds: string[]): Promise<{
  viewsAvailable: boolean;
  discussionAvailable: boolean;
  byId: Map<string, EstimateClientSignal>;
}> {
  const byId = new Map<string, EstimateClientSignal>();
  const ids = [...new Set(estimateIds.filter(Boolean))];
  if (!ids.length) {
    return { viewsAvailable: true, discussionAvailable: true, byId };
  }
  const supabase = await createClient();

  const views = await supabase
    .from("estimate_delivery")
    .select("estimate_id, view_count, first_viewed_at, last_viewed_at")
    .in("estimate_id", ids);
  const viewsAvailable = !views.error;
  if (viewsAvailable) {
    for (const row of views.data ?? []) {
      const id = row.estimate_id as string;
      byId.set(id, {
        view_count: Number(row.view_count ?? 0),
        first_viewed_at: (row.first_viewed_at as string) ?? null,
        last_viewed_at: (row.last_viewed_at as string) ?? null,
        discussion_requested_at: null,
        discussion_note: null,
      });
    }
  }

  const discussion = await supabase
    .from("estimates")
    .select("id, discussion_requested_at, discussion_note")
    .in("id", ids);
  const discussionAvailable = !discussion.error;
  if (discussionAvailable) {
    for (const row of discussion.data ?? []) {
      const id = row.id as string;
      const prev = byId.get(id);
      byId.set(id, {
        view_count: prev?.view_count ?? 0,
        first_viewed_at: prev?.first_viewed_at ?? null,
        last_viewed_at: prev?.last_viewed_at ?? null,
        discussion_requested_at: (row.discussion_requested_at as string) ?? null,
        discussion_note: (row.discussion_note as string) ?? null,
      });
    }
  }

  return { viewsAvailable, discussionAvailable, byId };
}

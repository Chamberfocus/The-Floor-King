import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  estimateBlockedUntilLeadAccepted,
  LEAD_ACCEPT_REQUIRED,
} from "@/lib/lead-acceptance";

/** Null when the signed-in person may write the estimate. */
export async function leadEstimateBlock(customerId: string): Promise<string | null> {
  if (!customerId) return null;
  const profile = await getProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .select("assigned_to, lead_acceptance")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !data) return null;
  if (
    estimateBlockedUntilLeadAccepted({
      role: profile.role,
      userId: profile.id,
      assignedTo: (data.assigned_to as string | null) ?? null,
      acceptance: (data.lead_acceptance as string | null) ?? null,
    })
  ) {
    return LEAD_ACCEPT_REQUIRED;
  }
  return null;
}

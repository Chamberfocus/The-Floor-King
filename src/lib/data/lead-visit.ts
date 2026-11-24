import { advanceFromAutoAction } from "@/lib/workflow-engine";
import type { LeadEstimateVisit } from "@/lib/lead-intake";

type InsertResult = { error: { message?: string } | null };

/**
 * Books the estimate visit that was filled in with the lead.
 * The customer row is already saved. A failed visit does not undo that.
 * No text or email goes out here — the office is still entering the lead.
 */
export async function saveLeadEstimateVisit(
  // The server client and the create-customer test double both insert here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  input: {
    customerId: string;
    salespersonId: string | null;
    createdBy: string | null;
    visit: LeadEstimateVisit;
    address: string | null;
  },
): Promise<string | null> {
  const startsAt = `${input.visit.date}T${input.visit.time}:00+00`;
  const inserted = await supabase.from("appointments").insert({
    customer_id: input.customerId,
    salesperson_id: input.salespersonId,
    kind: "estimate",
    starts_at: startsAt,
    ends_at: `${input.visit.date}T${input.visit.end}:00+00`,
    address: input.address,
    status: "scheduled",
    created_by: input.createdBy,
  });
  if (inserted.error) {
    return "The customer is saved. The estimate visit did not book — schedule it from the customer.";
  }
  await supabase.from("activities").insert({
    customer_id: input.customerId,
    user_id: input.createdBy,
    type: "note",
    body: `Estimate visit booked for ${input.visit.date} at ${input.visit.time}.`,
  });
  try {
    await advanceFromAutoAction(input.customerId, "schedule_estimate");
  } catch {
    /* the visit is on the calendar even if the stage did not move */
  }
  return null;
}

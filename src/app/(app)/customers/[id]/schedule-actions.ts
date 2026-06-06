"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEstimateSuggestions, type EstimateSlot } from "@/lib/data/scheduling";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";

export interface SuggestResult {
  error: string | null;
  slots?: EstimateSlot[];
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function suggestEstimateTimes(
  customerId: string,
  mode: "assigned" | "closest",
): Promise<SuggestResult> {
  if (!customerId) return { error: "Missing customer." };
  try {
    const slots = await getEstimateSuggestions(customerId, mode);
    if (!slots.length) {
      return {
        error:
          "No open times found. Make sure the customer has an address, and set your work hours under Settings → Scheduling.",
      };
    }
    return { error: null, slots };
  } catch {
    return { error: "Could not compute times right now." };
  }
}

export async function bookEstimateAppointment(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id"));
  const salesperson = str(formData.get("salesperson_id"));
  const date = str(formData.get("date"));
  const time = str(formData.get("time"));
  const endTime = str(formData.get("end_time"));
  const address = str(formData.get("address"));
  const driveMin = parseInt(str(formData.get("drive_minutes")), 10);
  if (!customerId || !date || !time) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("appointments").insert({
    customer_id: customerId,
    salesperson_id: salesperson || null,
    kind: "estimate",
    starts_at: `${date}T${time}:00+00`,
    ends_at: endTime ? `${date}T${endTime}:00+00` : null,
    address: address || null,
    drive_minutes: Number.isFinite(driveMin) ? driveMin : null,
    status: "scheduled",
    created_by: user?.id ?? null,
  });
  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "note",
    body: `Estimate appointment scheduled for ${date} at ${time}.`,
  });

  // Notify the salesperson and the customer.
  const { data: cust } = await supabase
    .from("customers")
    .select("full_name, email")
    .eq("id", customerId)
    .maybeSingle();
  const when = `${date} at ${time}`;
  if (salesperson) {
    const { data: rep } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", salesperson)
      .maybeSingle();
    if (rep?.email) {
      await sendEmail({
        to: rep.email as string,
        subject: `New estimate: ${cust?.full_name ?? "customer"} — ${when}`,
        html: emailLayout(
          "New estimate appointment",
          `<p>You're booked for an estimate with <strong>${cust?.full_name ?? "a customer"}</strong> on <strong>${when}</strong>.</p>
           ${address ? `<p>${address}</p>` : ""}`,
          { label: "Open customer", url: `${siteUrl()}/customers/${customerId}` },
        ),
      });
    }
  }
  if (cust?.email) {
    await sendEmail({
      to: cust.email as string,
      subject: "Your estimate appointment is confirmed",
      html: emailLayout(
        "Estimate confirmed",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Your in-home flooring estimate is confirmed for <strong>${when}</strong>. We look forward to seeing you!</p>`,
      ),
    });
  }

  revalidatePath(`/customers/${customerId}`);
}

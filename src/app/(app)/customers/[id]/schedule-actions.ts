"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { syncAppointmentToGoogle } from "@/lib/data/google-calendar";
import { createClient } from "@/lib/supabase/server";
import {
  getEstimateSuggestions,
  getSchedulingSettings,
  type EstimateSlot,
} from "@/lib/data/scheduling";
import { sendEmail, emailLayout, emailInfoCard, siteUrl } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { advanceFromAutoAction } from "@/lib/workflow-engine";
import { parseArrivalWindows, to12, formatDate, type ArrivalWindow } from "@/lib/format";
import { todayLocalYmd } from "@/lib/booking";

export interface SuggestResult {
  error: string | null;
  slots?: EstimateSlot[];
}

/** The shop's customizable arrival windows (for the manual booking dropdown). */
export async function getArrivalWindows(): Promise<ArrivalWindow[]> {
  const settings = await getSchedulingSettings();
  return parseArrivalWindows(settings.arrival_windows);
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
  // The booking popup decides who gets notified: the customer (send_email) and
  // the assigned estimator (notify_assignee). Absent = notify (back-compat).
  const skipClientEmail = str(formData.get("send_email")) === "no";
  const notifyAssignee = str(formData.get("notify_assignee")) !== "no";
  // Land back on the customer file by default; the LIST passes its own URL.
  const redirectTo = str(formData.get("redirect_to")) || null;
  if (!customerId || !date || !time) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Credit the estimate to the CLIENT'S salesperson (their owner), not whoever
  // happens to be booking it — unless a specific rep was chosen in the form.
  let salespersonId = salesperson || null;
  if (!salespersonId) {
    const { data: c } = await supabase
      .from("customers")
      .select("assigned_to")
      .eq("id", customerId)
      .maybeSingle();
    salespersonId = (c?.assigned_to as string) || null;
  }

  const startsAt = `${date}T${time}:00+00`;

  // Reschedule = REPLACE. Cancel any other still-upcoming estimate appointment
  // for this customer so we never end up showing it twice. (Past visits stay as
  // history; the slot we're (re)booking is left alone so the dup-guard below can
  // treat an exact re-pick as a no-op.)
  const today = todayLocalYmd();
  // Capture which ones we're about to cancel so we can pull their Google events.
  const { data: replaced } = await supabase
    .from("appointments")
    .select("id")
    .eq("customer_id", customerId)
    .eq("kind", "estimate")
    .eq("status", "scheduled")
    .gte("starts_at", `${today}T00:00:00+00`)
    .neq("starts_at", startsAt);
  await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("customer_id", customerId)
    .eq("kind", "estimate")
    .eq("status", "scheduled")
    .gte("starts_at", `${today}T00:00:00+00`)
    .neq("starts_at", startsAt);
  for (const r of replaced ?? [])
    await syncAppointmentToGoogle(r.id as string);

  // Guard against duplicates (e.g. a double-click): if this customer already
  // has an estimate appointment at this exact time, don't make another.
  const { data: existing } = await supabase
    .from("appointments")
    .select("id")
    .eq("customer_id", customerId)
    .eq("starts_at", startsAt)
    .neq("status", "cancelled")
    .maybeSingle();
  if (existing) {
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/schedule");
    revalidatePath("/calendar");
    redirect(redirectTo ?? `/customers/${customerId}`);
  }

  const { data: newAppt } = await supabase
    .from("appointments")
    .insert({
      customer_id: customerId,
      salesperson_id: salespersonId,
      kind: "estimate",
      starts_at: startsAt,
      ends_at: endTime ? `${date}T${endTime}:00+00` : null,
      address: address || null,
      drive_minutes: Number.isFinite(driveMin) ? driveMin : null,
      status: "scheduled",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (newAppt?.id) await syncAppointmentToGoogle(newAppt.id as string);
  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: user?.id ?? null,
    type: "note",
    body: `Estimate appointment scheduled for ${date} at ${time}.`,
  });

  // Notify the salesperson and the customer.
  const { data: cust } = await supabase
    .from("customers")
    .select("full_name, email, phone")
    .eq("id", customerId)
    .maybeSingle();
  const when = `${date} at ${time}`;
  // A friendly arrival window for the customer email/text.
  const niceDate = formatDate(date);
  const arrivalWindow = endTime
    ? `${to12(time)} – ${to12(endTime)}`
    : `around ${to12(time)}`;
  if (notifyAssignee && salesperson) {
    const { data: rep } = await supabase
      .from("profiles")
      .select("email, phone")
      .eq("id", salesperson)
      .maybeSingle();
    if (rep?.email) {
      await sendEmail({
        to: rep.email as string,
        subject: `📋 Estimate scheduled — ${cust?.full_name ?? "customer"}`,
        html: emailLayout(
          "You have an estimate scheduled",
          `<p>You're booked to run an estimate for <strong>${cust?.full_name ?? "a customer"}</strong>.</p>
           ${emailInfoCard(
             [
               { label: "Date", value: niceDate },
               { label: "Arrival window", value: arrivalWindow },
               ...(address ? [{ label: "Address", value: address }] : []),
             ],
             { title: "Your appointment" },
           )}`,
          { label: "Open the customer file", url: `${siteUrl()}/customers/${customerId}` },
          { preheader: `${cust?.full_name ?? "Customer"} · ${niceDate}, ${arrivalWindow}` },
        ),
      }).catch(() => {});
    }
    if (rep?.phone)
      await sendSms(
        rep.phone as string,
        `Floor King: estimate scheduled — ${cust?.full_name ?? "customer"} on ${niceDate}, ${arrivalWindow}.`,
      ).catch(() => {});
  }
  if (!skipClientEmail && cust?.email) {
    await sendEmail({
      to: cust.email as string,
      subject: "Your flooring estimate is confirmed 🎉",
      html: emailLayout(
        "Thank you for the opportunity!",
        `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
         <p>Thank you so much for the opportunity to earn your business — we're excited to see your space and help you find the perfect floors.</p>
         <p>Your in-home flooring estimate is confirmed. Here are the details:</p>
         ${emailInfoCard(
           [
             { label: "Date", value: niceDate },
             { label: "Arrival window", value: arrivalWindow },
             ...(address ? [{ label: "Address", value: address }] : []),
           ],
           { title: "Your appointment" },
         )}
         <p>We look forward to seeing you! If anything changes, just reply to this email.</p>`,
        undefined,
        { preheader: `Estimate confirmed for ${niceDate}, arriving ${arrivalWindow}.` },
      ),
    });
  }
  if (!skipClientEmail && cust?.phone) {
    await sendSms(
      cust.phone as string,
      `Cleveland Floor King: thank you for the opportunity! Your flooring estimate is confirmed for ${niceDate}, arriving ${arrivalWindow}. Reply with any questions!`,
    );
  }

  // Move the lead forward out of the "schedule estimate" stage automatically
  // (no-op if they're not on that stage).
  await advanceFromAutoAction(customerId, "schedule_estimate");

  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
  revalidatePath("/schedule");
  revalidatePath("/calendar");
  // Booked → close the scheduler out to the customer's dashboard.
  redirect(redirectTo ?? `/customers/${customerId}`);
}

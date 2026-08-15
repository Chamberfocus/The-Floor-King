"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicDaySlots, getPublicBookingConfig } from "@/lib/data/booking";
import { localNowIso } from "@/lib/booking";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";

export interface PublicSlot {
  hm: string;
  startIso: string;
  endIso: string;
  label: string;
}

function to12(hm: string): string {
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** Public: available start times for a date + appointment type. */
export async function publicDaySlots(
  typeId: string,
  ymd: string,
): Promise<PublicSlot[]> {
  const { types } = await getPublicBookingConfig();
  const type = types.find((t) => t.id === typeId);
  if (!type) return [];
  const slots = await getPublicDaySlots(ymd, type.duration_min, localNowIso());
  return slots
    .filter((s) => s.available)
    .map((s) => ({
      hm: s.hm,
      startIso: s.startIso,
      endIso: s.endIso,
      label: to12(s.hm),
    }));
}

export interface RequestResult {
  error: string | null;
  ok?: boolean;
}

/** Public: submit an appointment request (creates a lead + pending appt). */
export async function submitBookingRequest(input: {
  typeId: string;
  startIso: string;
  endIso: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}): Promise<RequestResult> {
  const name = input.name?.trim();
  const phone = input.phone?.trim();
  const email = input.email?.trim();
  if (!name) return { error: "Please enter your name." };
  if (!phone && !email)
    return { error: "Please enter a phone number or email so we can confirm." };

  const { settings, types } = await getPublicBookingConfig();
  if (!settings.booking_enabled)
    return { error: "Online booking is currently turned off. Please call us." };
  const type = types.find((t) => t.id === input.typeId);
  if (!type) return { error: "Please choose an appointment type." };
  if (!input.startIso) return { error: "Please choose a time." };

  // Re-check the slot is still open (avoid a race / double-book).
  const ymd = input.startIso.slice(0, 10);
  const open = await getPublicDaySlots(ymd, type.duration_min, localNowIso());
  const stillFree = open.some((s) => s.startIso === input.startIso && s.available);
  if (!stillFree)
    return {
      error: "Sorry, that time was just taken. Please pick another time.",
    };

  const admin = createAdminClient();

  // Create a lead so staff can work the request like any other.
  const { data: cust, error: custErr } = await admin
    .from("customers")
    .insert({
      full_name: name,
      phone: phone || null,
      email: email || null,
      stage: "new",
      source: "website",
    })
    .select("id")
    .single();
  if (custErr || !cust)
    return { error: custErr?.message || "Couldn't submit your request." };

  const { error: apptErr } = await admin.from("appointments").insert({
    customer_id: cust.id,
    type_id: type.id,
    kind: type.kind,
    starts_at: input.startIso,
    ends_at: input.endIso,
    status: "pending",
    source: "client",
    contact_name: name,
    contact_phone: phone || null,
    contact_email: email || null,
    notes: input.notes?.trim() || null,
  });
  if (apptErr) return { error: apptErr.message };

  // Tell the shop a request came in.
  const whenText = `${ymd} at ${to12(input.startIso.slice(11, 16))}`;
  await sendEmail({
    to: ownerEmail(),
    subject: `New appointment request — ${name} (${type.name})`,
    html: emailLayout(
      "New appointment request",
      `<p><strong>${name}</strong> requested a <strong>${type.name}</strong> for <strong>${whenText}</strong>.</p>
       <p>${phone ? `Phone: ${phone}<br/>` : ""}${email ? `Email: ${email}` : ""}</p>
       <p>Confirm it on the calendar.</p>`,
      { label: "Open calendar", url: `${siteUrl()}/calendar` },
    ),
  });

  // Acknowledge to the client.
  if (email) {
    await sendEmail({
      to: email,
      subject: "We got your appointment request",
      html: emailLayout(
        "Request received",
        `<p>Hi ${name.split(" ")[0]},</p>
         <p>Thanks! We received your request for a <strong>${type.name}</strong> on <strong>${whenText}</strong>. Our team will confirm shortly.</p>
         <p>Cleveland Floor King · 3580 West 140th St, Cleveland, OH 44111</p>`,
      ),
    });
  }

  // Surface the new lead + pending request on the staff calendar, customer list,
  // and pipeline right away (staff otherwise only get the email).
  revalidatePath("/calendar");
  revalidatePath("/customers");
  revalidatePath("/client-status");
  return { error: null, ok: true };
}

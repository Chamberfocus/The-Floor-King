"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAppointmentType } from "@/lib/data/booking";
import { parseHm, hmFromMinutes, isoAt } from "@/lib/booking";
import { sendEmail, emailLayout } from "@/lib/notify";
import { sendSms } from "@/lib/sms";

import { listCustomers } from "@/lib/data/customers";

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

/** Debounced customer lookup for the booking dialog. */
export async function searchCustomersForBooking(
  query: string,
): Promise<CustomerHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await listCustomers({ search: q });
  return rows.slice(0, 12).map((c) => ({
    id: c.id,
    name: c.full_name || c.company || "Customer",
    phone: c.phone ?? null,
    email: c.email ?? null,
    address: [c.street, c.city, c.state].filter(Boolean).join(", ") || null,
  }));
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function nul(v: FormDataEntryValue | null): string | null {
  return str(v) || null;
}

/** Build start/end UTC ISO timestamps from a date, time, and duration. */
function window(date: string, time: string, durationMin: number) {
  const startMin = parseHm(time);
  return {
    starts_at: `${date}T${time.length === 5 ? `${time}:00` : time}Z`,
    ends_at: isoAt(date, startMin + durationMin),
    endTime: hmFromMinutes(startMin + durationMin),
  };
}

async function notifyCustomerConfirmed(
  customerName: string | null,
  email: string | null,
  phone: string | null,
  typeName: string,
  whenText: string,
) {
  if (email) {
    await sendEmail({
      to: email,
      subject: "Your appointment is confirmed",
      html: emailLayout(
        "Appointment confirmed",
        `<p>Hi ${customerName?.split(" ")[0] ?? "there"},</p>
         <p>Your <strong>${typeName}</strong> is confirmed for <strong>${whenText}</strong>. We look forward to seeing you!</p>
         <p>Cleveland Floor King · 3580 West 140th St, Cleveland, OH 44111</p>`,
      ),
    });
  }
  if (phone) {
    await sendSms(
      phone,
      `Cleveland Floor King: your ${typeName} is confirmed for ${whenText}. Reply with any questions!`,
    );
  }
}

/** Staff books an appointment directly (status = scheduled). */
export async function createAppointment(formData: FormData): Promise<void> {
  const customerId = nul(formData.get("customer_id"));
  const typeId = nul(formData.get("type_id"));
  const date = str(formData.get("date"));
  const time = str(formData.get("time"));
  if (!date || !time) return;

  const type = typeId ? await getAppointmentType(typeId) : null;
  const duration = type?.duration_min ?? 45;
  const w = window(date, time, duration);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await supabase.from("appointments").insert({
    customer_id: customerId,
    type_id: typeId,
    kind: type?.kind ?? "showroom",
    salesperson_id: nul(formData.get("salesperson_id")),
    starts_at: w.starts_at,
    ends_at: w.ends_at,
    address: nul(formData.get("address")),
    notes: nul(formData.get("notes")),
    contact_name: nul(formData.get("contact_name")),
    contact_phone: nul(formData.get("contact_phone")),
    contact_email: nul(formData.get("contact_email")),
    status: "scheduled",
    source: "staff",
    created_by: user?.id ?? null,
  });

  // Confirm to the customer when we have contact info.
  let email = nul(formData.get("contact_email"));
  let phone = nul(formData.get("contact_phone"));
  let name = nul(formData.get("contact_name"));
  if (customerId) {
    const { data: c } = await supabase
      .from("customers")
      .select("full_name, email, phone")
      .eq("id", customerId)
      .maybeSingle();
    name = (c?.full_name as string) ?? name;
    email = email ?? ((c?.email as string) ?? null);
    phone = phone ?? ((c?.phone as string) ?? null);
  }
  await notifyCustomerConfirmed(
    name,
    email,
    phone,
    type?.name ?? "appointment",
    `${date} at ${time}`,
  );

  revalidatePath("/calendar");
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

/** Block out staff time (no customer). */
export async function blockTime(formData: FormData): Promise<void> {
  const date = str(formData.get("date"));
  const time = str(formData.get("time"));
  const endTime = str(formData.get("end_time")) || time;
  if (!date || !time) return;

  const startMin = parseHm(time);
  const endMin = Math.max(startMin + 15, parseHm(endTime));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("appointments").insert({
    is_block: true,
    title: str(formData.get("title")) || "Blocked",
    kind: "other",
    salesperson_id: nul(formData.get("salesperson_id")),
    starts_at: isoAt(date, startMin),
    ends_at: isoAt(date, endMin),
    notes: nul(formData.get("notes")),
    status: "scheduled",
    source: "staff",
    created_by: user?.id ?? null,
  });
  revalidatePath("/calendar");
}

/** Move an appointment to a new date/time (and optionally rep). */
export async function rescheduleAppointment(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const date = str(formData.get("date"));
  const time = str(formData.get("time"));
  if (!id || !date || !time) return;

  const supabase = await createClient();
  const { data: appt } = await supabase
    .from("appointments")
    .select("type_id, starts_at, ends_at")
    .eq("id", id)
    .maybeSingle();
  let duration = 45;
  if (appt?.type_id) {
    const t = await getAppointmentType(appt.type_id as string);
    if (t) duration = t.duration_min;
  } else if (appt?.starts_at && appt?.ends_at) {
    duration = Math.max(
      15,
      Math.round(
        (new Date(appt.ends_at as string).getTime() -
          new Date(appt.starts_at as string).getTime()) /
          60000,
      ),
    );
  }
  const w = window(date, time, duration);
  const repRaw = formData.get("salesperson_id");
  const update: Record<string, unknown> = {
    starts_at: w.starts_at,
    ends_at: w.ends_at,
  };
  if (repRaw !== null) update.salesperson_id = nul(repRaw);

  await supabase.from("appointments").update(update).eq("id", id);
  revalidatePath("/calendar");
}

/** Change an appointment's status (completed / cancelled / no_show). */
export async function setAppointmentStatus(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status"));
  if (!id || !status) return;
  const allowed = ["scheduled", "completed", "cancelled", "no_show"];
  if (!allowed.includes(status)) return;
  const supabase = await createClient();
  await supabase.from("appointments").update({ status }).eq("id", id);
  revalidatePath("/calendar");
}

/** Confirm a client request: pending → scheduled, assign a rep, notify. */
export async function confirmRequest(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;

  const supabase = await createClient();
  const repRaw = formData.get("salesperson_id");

  // Optional reschedule on confirm.
  const date = str(formData.get("date"));
  const time = str(formData.get("time"));

  const { data: appt } = await supabase
    .from("appointments")
    .select(
      "type_id, starts_at, ends_at, customer_id, contact_name, contact_email, contact_phone",
    )
    .eq("id", id)
    .maybeSingle();
  if (!appt) return;

  const update: Record<string, unknown> = { status: "scheduled" };
  if (repRaw !== null) update.salesperson_id = nul(repRaw);
  if (date && time) {
    let duration = 45;
    if (appt.type_id) {
      const t = await getAppointmentType(appt.type_id as string);
      if (t) duration = t.duration_min;
    }
    const w = window(date, time, duration);
    update.starts_at = w.starts_at;
    update.ends_at = w.ends_at;
  }
  await supabase.from("appointments").update(update).eq("id", id);

  // Notify the client.
  const startsAt =
    (update.starts_at as string) ?? (appt.starts_at as string) ?? "";
  const d = new Date(startsAt);
  const whenText = `${d.toISOString().slice(0, 10)} at ${hmFromMinutes(
    d.getUTCHours() * 60 + d.getUTCMinutes(),
  )}`;
  let name = (appt.contact_name as string) ?? null;
  let email = (appt.contact_email as string) ?? null;
  let phone = (appt.contact_phone as string) ?? null;
  let typeName = "appointment";
  if (appt.type_id) {
    const t = await getAppointmentType(appt.type_id as string);
    typeName = t?.name ?? typeName;
  }
  if (appt.customer_id) {
    const { data: c } = await supabase
      .from("customers")
      .select("full_name, email, phone")
      .eq("id", appt.customer_id as string)
      .maybeSingle();
    name = (c?.full_name as string) ?? name;
    email = email ?? ((c?.email as string) ?? null);
    phone = phone ?? ((c?.phone as string) ?? null);
  }
  await notifyCustomerConfirmed(name, email, phone, typeName, whenText);

  revalidatePath("/calendar");
}

export async function deleteAppointment(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("appointments").delete().eq("id", id);
  revalidatePath("/calendar");
}
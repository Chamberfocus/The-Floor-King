"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { sendJobToWarehouse } from "@/app/(app)/jobs/actions";
import type { OrderItem } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Owner/office approves an order → creates a cash-and-carry job and sends it to
 *  the warehouse to be cut & staged for pickup. */
export async function approveOrder(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  if (!orderId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user?.id ?? null;

  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "submitted") return;
  const { data: itemData } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  const items = (itemData ?? []) as OrderItem[];

  // Resolve or create the customer (public orders have none yet).
  let customerId = (order.customer_id as string | null) ?? null;
  if (!customerId) {
    const { data: c } = await supabase
      .from("customers")
      .insert({
        full_name: (order.contact_name as string) || "Order customer",
        phone: (order.contact_phone as string) || null,
        email: (order.contact_email as string) || null,
        source: "walk_in",
        stage: "won",
        created_by: uid,
        assigned_to: uid,
      })
      .select("id")
      .single();
    customerId = (c?.id as string) ?? null;
    if (customerId)
      await supabase
        .from("orders")
        .update({ customer_id: customerId })
        .eq("id", orderId);
  }
  if (!customerId) return;

  // Build the warehouse cut list from the order items.
  const cutList = items
    .map((it) => {
      const desc = [it.description, it.color, it.style].filter(Boolean).join(", ");
      const qty = it.quantity ? ` (${it.quantity} ${it.unit})` : "";
      const cuts = it.cut_notes ? ` — cuts: ${it.cut_notes}` : "";
      return `• ${desc || "Item"}${qty}${cuts}`;
    })
    .join("\n");
  const custName = (order.contact_name as string) || "Order";
  const jobNotes = `To stage: CASH & CARRY — cut for pickup\n${cutList}${
    order.notes ? `\n\nCustomer note: ${order.notes}` : ""
  }`;

  const { data: job } = await supabase
    .from("jobs")
    .insert({
      customer_id: customerId,
      title: `Carpet order — ${custName}`,
      delivery_type: "cash_carry",
      status: "unscheduled",
      notes: jobNotes,
      created_by: uid,
    })
    .select("id")
    .single();
  const jobId = (job?.id as string) ?? null;

  await supabase
    .from("orders")
    .update({
      status: "approved",
      job_id: jobId,
      approved_by: uid,
      approved_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  // Send the new cash-and-carry job to the warehouse to cut & stage.
  if (jobId) await sendJobToWarehouse(jobId);

  // Let the client know it's approved.
  const email = order.contact_email as string | null;
  if (email) {
    await sendEmail({
      to: email,
      subject: "Your order is approved ✅",
      html: emailLayout(
        "Order approved",
        `<p>Hi ${custName.split(" ")[0]},</p>
         <p>Your order is approved and headed to our warehouse to be cut. We'll
         reach out with pricing and let you know as soon as it's ready for pickup.</p>`,
      ),
    });
  }

  revalidatePath("/orders");
  revalidatePath("/warehouse");
  revalidatePath(`/customers/${customerId}`);
}

export async function declineOrder(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  const reason = str(formData.get("reason"));
  if (!orderId) return;
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("contact_name, contact_email, status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "submitted") return;

  await supabase
    .from("orders")
    .update({ status: "declined", decline_reason: reason || null })
    .eq("id", orderId);

  const email = order.contact_email as string | null;
  if (email) {
    await sendEmail({
      to: email,
      subject: "About your order",
      html: emailLayout(
        "Order update",
        `<p>Hi ${((order.contact_name as string) || "there").split(" ")[0]},</p>
         <p>Thanks for your order. Unfortunately we can't fill it as submitted${
           reason ? `: ${reason}` : "."
         } Please give us a call and we'll sort it out.</p>`,
      ),
    });
  }
  revalidatePath("/orders");
}

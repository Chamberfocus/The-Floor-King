"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { sendJobToWarehouse } from "@/app/(app)/jobs/actions";
import { buildInvoiceFromOrder } from "@/lib/data/order-invoice";
import type { OrderItem, OrderStockStatus } from "@/lib/types";

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

/** Warehouse (or staff) flags whether an order is in stock → pings the owner.
 *  Runs elevated (warehouse can read orders but not write them under RLS). */
export async function reportOrderStock(formData: FormData): Promise<void> {
  const orderId = str(formData.get("order_id"));
  const status = str(formData.get("stock_status")) as OrderStockStatus;
  const note = str(formData.get("stock_note"));
  if (!orderId || !["in_stock", "out_of_stock", "partial"].includes(status))
    return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { data: me } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const role = me?.role as string | undefined;
  if (!role || !["admin", "office", "warehouse"].includes(role)) return;

  const admin = createAdminClient();
  await admin
    .from("orders")
    .update({
      stock_status: status,
      stock_note: note || null,
      stock_checked_by: user.id,
      stock_checked_at: new Date().toISOString(),
    })
    .eq("id", orderId);

  const { data: order } = await admin
    .from("orders")
    .select("contact_name")
    .eq("id", orderId)
    .maybeSingle();
  const who = (order?.contact_name as string) || "an order";
  const label =
    status === "in_stock"
      ? "IN STOCK ✅"
      : status === "out_of_stock"
        ? "OUT OF STOCK ❌"
        : "PARTIAL ⚠️";
  await sendEmail({
    to: ownerEmail(),
    subject: `📦 Stock check — ${who}: ${label}`,
    html: emailLayout(
      "Warehouse stock check",
      `<p>${(me?.full_name as string) || "Warehouse"} marked the order from <strong>${who}</strong> as <strong>${label}</strong>${note ? ` — ${note}` : ""}.</p>`,
      { label: "Open orders", url: `${siteUrl()}/orders` },
    ),
  });
  revalidatePath("/orders");
  revalidatePath("/warehouse");
}

/** Owner/office relays the stock status to the customer (portal note + email). */
export async function notifyCustomerStock(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  if (!orderId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: order } = await supabase
    .from("orders")
    .select("customer_id, contact_name, contact_email, stock_status, stock_note")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;
  const s = order.stock_status as OrderStockStatus;
  const base =
    s === "in_stock"
      ? "Good news — we have your carpet in stock and can cut it for pickup."
      : s === "out_of_stock"
        ? "Heads up — the carpet you asked for isn't in stock right now. We'll reach out about options and timing."
        : s === "partial"
          ? "We have part of your order in stock — we'll reach out about the rest."
          : "We're checking stock on your order and will update you shortly.";
  const body = `${base}${order.stock_note ? ` (${order.stock_note})` : ""}`;

  if (order.customer_id) {
    await supabase.from("messages").insert({
      customer_id: order.customer_id,
      channel: "client",
      author_id: user?.id ?? null,
      body: `📦 ${body}`,
    });
  }
  if (order.contact_email) {
    await sendEmail({
      to: order.contact_email as string,
      subject: "Update on your order",
      html: emailLayout("Order update", `<p>${body}</p>`),
    });
  }
  await supabase
    .from("orders")
    .update({ customer_stock_notified_at: new Date().toISOString() })
    .eq("id", orderId);
  revalidatePath("/orders");
}

/** Build a draft invoice from an approved order — you set the trade prices. */
export async function createInvoiceFromOrder(
  formData: FormData,
): Promise<void> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  if (!orderId) return;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const invId = await buildInvoiceFromOrder(supabase, orderId, user?.id ?? null);
  revalidatePath("/orders");
  revalidatePath("/invoices");
  if (invId) redirect(`/invoices/${invId}`);
}

/** Permanently remove an order AND everything it spawned: the warehouse job it
 *  created (and that job's staging files, labor, and satisfaction sign-off), the
 *  invoice (with its line items and payments), and any purchase orders raised
 *  for it. Physical inventory (rolls / remnants / stock movements) and uploaded
 *  documents are kept — those are real-world records, not order paperwork.
 *  Admin/office only. */
export async function deleteOrder(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  if (!orderId) return;

  // Elevated: sidestep any gap in orders' RLS delete policy (public orders have
  // no customer/owner), and reach the spawned job/invoice/POs.
  const admin = createAdminClient();

  // Find what this order spawned BEFORE deleting anything.
  const { data: order } = await admin
    .from("orders")
    .select("job_id, invoice_id")
    .eq("id", orderId)
    .maybeSingle();
  const jobId = (order?.job_id as string | null) ?? null;
  const invoiceId = (order?.invoice_id as string | null) ?? null;

  // Purchase orders + invoices tied to the spawned job. These must go first:
  // their job_id is ON DELETE SET NULL, so once the job is gone we can no longer
  // find them. po_items / invoice_items / payments cascade with their parent.
  if (jobId) {
    await admin.from("purchase_orders").delete().eq("job_id", jobId);
    await admin.from("invoices").delete().eq("job_id", jobId);
  }
  // The invoice the order links to directly (belt-and-suspenders if it wasn't
  // caught by the job match above).
  if (invoiceId) await admin.from("invoices").delete().eq("id", invoiceId);

  // The job itself — cascades job_files, job_labor, job_satisfaction, and
  // job_applications; unlinks documents/inventory (kept on purpose).
  if (jobId) await admin.from("jobs").delete().eq("id", jobId);

  // Finally the order and its line items (order_items also cascades on the order
  // delete; we clear it explicitly to be safe).
  await admin.from("order_items").delete().eq("order_id", orderId);
  await admin.from("orders").delete().eq("id", orderId);

  revalidatePath("/orders");
  revalidatePath("/invoices");
  revalidatePath("/purchase-orders");
  revalidatePath("/jobs");
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

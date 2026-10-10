"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { formatDate } from "@/lib/format";
import { sendJobToWarehouse } from "@/app/(app)/jobs/actions";
import { buildInvoiceFromOrder } from "@/lib/data/order-invoice";
import { resolveOrCreateCustomer } from "@/lib/data/customer-resolve";
import type { ScoredCustomerMatch } from "@/lib/customer-resolve";
import type { OrderItem, OrderStockStatus } from "@/lib/types";
import {
  WAREHOUSE_STOCK_CHECK_REQUIRED,
  canApproveCustomerOrder,
  canStageCustomerOrder,
} from "@/lib/order-warehouse-gates";
import { cutsTotalSqYd } from "@/lib/order-cuts";
import { refuseNewActiveWorkForCustomer } from "@/lib/active-work-guard";
import {
  deleteErrorPreservesHistory,
  orderDestructionBlocker,
  type InvoicePaperwork,
  type PurchaseOrderPaperwork,
} from "@/lib/order-deletion";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function orderCutList(items: OrderItem[]): string {
  return items
    .map((it) => {
      const desc = [it.description, it.color, it.style].filter(Boolean).join(", ");
      // Exclusive carpet-tile office customer-order email qty from cuts is the order, not leftover planted quantity — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
      // Hard-surface office customer-order email leftover planted quantity stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
      const qty = cutsTotalSqYd(it) == null && it.quantity ? ` (${it.quantity} ${it.unit})` : "";
      const cuts = it.cut_notes ? ` — cuts: ${it.cut_notes}` : "";
      return `• ${desc || "Item"}${qty}${cuts}`;
    })
    .join("\n");
}

/**
 * Create the cash-and-carry warehouse job at most once. Concurrent in_stock
 * clicks may insert a spare row; the loser is deleted after the job_id lock.
 */
async function ensureOrderCashCarryJob(args: {
  order: {
    id: string;
    job_id: string | null;
    contact_name: string | null;
    notes: string | null;
    customer_id: string | null;
  };
  items: OrderItem[];
  uid: string | null;
}): Promise<string | null> {
  if (args.order.job_id) return args.order.job_id;
  if (!args.order.customer_id) return null;
  const admin = createAdminClient();
  const orderBlocked = await refuseNewActiveWorkForCustomer(admin, args.order.customer_id);
  if (orderBlocked) return null;
  const custName = args.order.contact_name || "Order";
  const jobNotes = `To stage: CASH & CARRY — cut for pickup\n${orderCutList(args.items)}${
    args.order.notes ? `\n\nCustomer note: ${args.order.notes}` : ""
  }`;
  const { data: job } = await admin
    .from("jobs")
    .insert({
      customer_id: args.order.customer_id,
      title: `Carpet order — ${custName}`,
      delivery_type: "cash_carry",
      status: "unscheduled",
      notes: jobNotes,
      created_by: args.uid,
    })
    .select("id")
    .single();
  const insertedId = (job?.id as string | undefined) ?? null;
  if (!insertedId) return null;
  await admin
    .from("orders")
    .update({ job_id: insertedId })
    .eq("id", args.order.id)
    .is("job_id", null);
  const { data: latest } = await admin
    .from("orders")
    .select("job_id")
    .eq("id", args.order.id)
    .maybeSingle();
  const kept = (latest?.job_id as string | null) ?? null;
  if (kept && kept !== insertedId) {
    await admin.from("jobs").delete().eq("id", insertedId);
  }
  return kept ?? insertedId;
}

async function sendApprovedInStockOrderToWarehouse(args: {
  order: {
    id: string;
    job_id: string | null;
    contact_name: string | null;
    notes: string | null;
    customer_id: string | null;
    status: string;
    stock_status: string;
  };
  items: OrderItem[];
  uid: string | null;
}): Promise<void> {
  if (
    !canStageCustomerOrder({
      status: args.order.status,
      stockStatus: args.order.stock_status,
    })
  ) {
    return;
  }
  const jobId = await ensureOrderCashCarryJob({
    order: args.order,
    items: args.items,
    uid: args.uid,
  });
  if (jobId) await sendJobToWarehouse(jobId);
}

/** Owner/office approves an order → creates a cash-and-carry job and sends it to
 *  the warehouse to be cut & staged for pickup. */
export async function approveOrder(formData: FormData): Promise<{
  error: string | null;
  ok?: boolean;
  matches?: ScoredCustomerMatch[];
}> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  if (!orderId) return { error: "Missing order." };

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
  if (!order || order.status !== "submitted") return { error: "That order is not waiting on approval." };
  if (!canApproveCustomerOrder(order.stock_status as string)) {
    return { error: WAREHOUSE_STOCK_CHECK_REQUIRED };
  }
  const { data: itemData } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  const items = (itemData ?? []) as OrderItem[];

  const alreadyLinked = (order.customer_id as string | null) || null;
  let customerId = alreadyLinked;
  // Do not re-resolve (or rewrite) an order that already has a customer.
  // When customer_id is null, match contact against existing customers and
  // require an explicit choice before inserting a new UUID.
  if (!alreadyLinked) {
    const contactName = (order.contact_name as string) || "Order customer";
    const resolved = await resolveOrCreateCustomer({
      input: {
        fullName: contactName,
        phone: (order.contact_phone as string) || null,
        email: (order.contact_email as string) || null,
      },
      insert: {
        full_name: contactName,
        phone: (order.contact_phone as string) || null,
        email: (order.contact_email as string) || null,
        source: "walk_in",
        stage: "won",
        created_by: uid,
        assigned_to: uid,
      },
      useExistingId: str(formData.get("use_existing_id")) || null,
      forceCreate: str(formData.get("force_create")) === "1",
      overrideReason: str(formData.get("duplicate_override_reason")),
    });
    if (resolved.action === "needs_choice") {
      return { error: null, matches: resolved.matches };
    }
    if (resolved.action === "error") return { error: resolved.error };
    customerId = resolved.customerId;
  }
  if (!customerId) return { error: "Couldn't attach a customer." };
  const approveBlocked = await refuseNewActiveWorkForCustomer(supabase, customerId);
  if (approveBlocked) return { error: approveBlocked };

  const readyDate = str(formData.get("ready_date")) || null;
  const readyKindRaw = str(formData.get("ready_kind"));
  const readyKind =
    readyKindRaw === "on_order" || readyKindRaw === "from_stock" ? readyKindRaw : null;

  // Re-read immediately before the status lock so a stale UI cannot approve
  // an order the warehouse has not checked (or has since changed).
  const { data: latest } = await supabase
    .from("orders")
    .select("id, status, stock_status, job_id, customer_id, contact_name, contact_email, notes")
    .eq("id", orderId)
    .maybeSingle();
  if (!latest || latest.status !== "submitted") {
    return { error: "That order is not waiting on approval." };
  }
  if (!canApproveCustomerOrder(latest.stock_status as string)) {
    return { error: WAREHOUSE_STOCK_CHECK_REQUIRED };
  }
  const stockNow = latest.stock_status as OrderStockStatus;

  const { data: locked } = await supabase
    .from("orders")
    .update({
      status: "approved",
      customer_id: customerId,
      approved_by: uid,
      approved_at: new Date().toISOString(),
      ...(readyDate ? { ready_date: readyDate } : {}),
      ...(readyKind ? { ready_kind: readyKind } : {}),
    })
    .eq("id", orderId)
    .eq("status", "submitted")
    .select("id")
    .maybeSingle();
  if (!locked) {
    return { error: "That order is not waiting on approval." };
  }

  if (stockNow === "in_stock") {
    await sendApprovedInStockOrderToWarehouse({
      order: {
        id: orderId,
        job_id: (latest.job_id as string | null) ?? null,
        contact_name: (latest.contact_name as string | null) ?? null,
        notes: (latest.notes as string | null) ?? null,
        customer_id: customerId,
        status: "approved",
        stock_status: stockNow,
      },
      items,
      uid,
    });
  }

  const custName = (latest.contact_name as string) || "Order";
  const email = latest.contact_email as string | null;
  if (email) {
    const when = readyDate ? formatDate(readyDate) : null;
    const onOrder = readyKind === "on_order";
    const headingWarehouse = stockNow === "in_stock";
    const line = headingWarehouse
      ? when
        ? onOrder
          ? `<p>We don't have all of this on the shelf, so we're ordering it in for you. It should be cut and ready to collect on <strong>${when}</strong>.</p>`
          : `<p>We have your material in stock. It'll be cut and ready to collect on <strong>${when}</strong>.</p>`
        : `<p>Your order is approved and headed to our warehouse to be cut. We'll let you know as soon as it's ready for pickup.</p>`
      : `<p>Your order is approved. Our warehouse reported a material shortage, so it is not headed to staging yet — we'll be in touch about timing.</p>`;
    await sendEmail({
      to: email,
      subject: headingWarehouse
        ? when
          ? `Your order is approved — ready ${when}`
          : "Your order is approved ✅"
        : "Your order is approved — we'll confirm material",
      html: emailLayout(
        "Order approved",
        `<p>Hi ${custName.split(" ")[0]},</p>
         ${line}
         <p>We'll be in touch with pricing. Reply to this email if you need to change anything.</p>`,
      ),
    });
  }

  revalidatePath("/orders");
  revalidatePath("/warehouse");
  revalidatePath("/jobs");
  revalidatePath("/board");
  revalidatePath("/dashboard");
  revalidatePath(`/customers/${customerId}`);
  return { error: null, ok: true };
}

/** Warehouse (or staff) flags whether an order is in stock → pings the owner.
 *  Runs elevated (warehouse can read orders but not write them under RLS).
 *  Writes only stock columns — never approval, price, invoice, or accounting. */
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
    .select(
      "id, status, stock_status, job_id, customer_id, contact_name, notes",
    )
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

  if (
    order &&
    canStageCustomerOrder({
      status: order.status as string,
      stockStatus: order.stock_status as string,
    })
  ) {
    const { data: itemData } = await admin
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("position", { ascending: true });
    await sendApprovedInStockOrderToWarehouse({
      order: {
        id: order.id as string,
        job_id: (order.job_id as string | null) ?? null,
        contact_name: (order.contact_name as string | null) ?? null,
        notes: (order.notes as string | null) ?? null,
        customer_id: (order.customer_id as string | null) ?? null,
        status: order.status as string,
        stock_status: order.stock_status as string,
      },
      items: (itemData ?? []) as OrderItem[],
      uid: user.id,
    });
  }

  revalidatePath("/orders");
  revalidatePath("/warehouse");
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
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
  revalidatePath("/portal");
  if (order.customer_id) revalidatePath(`/customers/${order.customer_id}`);
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
  const { data: ord } = await supabase
    .from("orders")
    .select("customer_id")
    .eq("id", orderId)
    .maybeSingle();
  revalidatePath("/orders");
  revalidatePath("/invoices");
  if (ord?.customer_id) revalidatePath(`/customers/${ord.customer_id}`);
  if (invId) redirect(`/invoices/${invId}`);
}

const ORDER_KEPT =
  "This order was not deleted. Its related records could not be read, so nothing was removed.";

function orderDeleteDenied(message: string): never {
  revalidatePath("/orders");
  redirect(`/orders?order_error=${encodeURIComponent(message)}`);
}

function tally(rows: { invoice_id?: string | null }[] | null, invoiceId: string): number {
  return (rows ?? []).filter((row) => row.invoice_id === invoiceId).length;
}

function receivedQty(items: { received_qty?: number | string | null }[] | null): number {
  return (items ?? []).reduce((sum, item) => sum + (Number(item.received_qty) || 0), 0);
}

/** Remove an order only when it has no posted financial history.
 *  Issued invoices, payments, credits, deposits, write-offs, issued or
 *  received purchase orders, and job cost history are kept. Untouched draft
 *  paperwork can still be removed. Admin/office only. */
export async function deleteOrder(formData: FormData): Promise<void> {
  await assertRole(["admin", "office"]);
  const orderId = str(formData.get("order_id"));
  if (!orderId) return;

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    orderDeleteDenied(ORDER_KEPT);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("job_id, invoice_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) orderDeleteDenied(ORDER_KEPT);
  if (!order) orderDeleteDenied("This order was not found. Nothing was deleted.");

  const jobId = (order.job_id as string | null) ?? null;
  const directInvoiceId = (order.invoice_id as string | null) ?? null;

  const invoiceById = new Map<string, { id: string; status: string | null }>();
  if (jobId) {
    const { data, error } = await admin
      .from("invoices")
      .select("id, status")
      .eq("job_id", jobId);
    if (error) orderDeleteDenied(ORDER_KEPT);
    for (const row of data ?? []) {
      invoiceById.set(row.id as string, {
        id: row.id as string,
        status: (row.status as string | null) ?? null,
      });
    }
  }
  if (directInvoiceId && !invoiceById.has(directInvoiceId)) {
    const { data, error } = await admin
      .from("invoices")
      .select("id, status")
      .eq("id", directInvoiceId)
      .maybeSingle();
    if (error) orderDeleteDenied(ORDER_KEPT);
    if (data) {
      invoiceById.set(data.id as string, {
        id: data.id as string,
        status: (data.status as string | null) ?? null,
      });
    }
  }

  const invoiceIds = [...invoiceById.keys()];
  let paymentRows: { invoice_id?: string | null }[] | null = [];
  let creditRows: { invoice_id?: string | null }[] | null = [];
  let depositRows: { invoice_id?: string | null }[] | null = [];
  let writeOffRows: { invoice_id?: string | null }[] | null = [];
  if (invoiceIds.length) {
    const [payments, credits, deposits, writeOffs] = await Promise.all([
      admin.from("payments").select("invoice_id").in("invoice_id", invoiceIds),
      admin.from("credit_applications").select("invoice_id").in("invoice_id", invoiceIds),
      admin
        .from("customer_deposit_applications")
        .select("invoice_id")
        .in("invoice_id", invoiceIds),
      admin.from("invoice_write_offs").select("invoice_id").in("invoice_id", invoiceIds),
    ]);
    if (payments.error || credits.error || deposits.error || writeOffs.error) {
      orderDeleteDenied(ORDER_KEPT);
    }
    paymentRows = payments.data as { invoice_id?: string | null }[] | null;
    creditRows = credits.data as { invoice_id?: string | null }[] | null;
    depositRows = deposits.data as { invoice_id?: string | null }[] | null;
    writeOffRows = writeOffs.data as { invoice_id?: string | null }[] | null;
  }

  const invoices: InvoicePaperwork[] = [...invoiceById.values()].map((invoice) => ({
    status: invoice.status,
    paymentCount: tally(paymentRows, invoice.id),
    creditApplicationCount: tally(creditRows, invoice.id),
    depositApplicationCount: tally(depositRows, invoice.id),
    writeOffCount: tally(writeOffRows, invoice.id),
  }));

  let purchaseOrders: PurchaseOrderPaperwork[] = [];
  let draftPoIds: string[] = [];
  let jobLaborCount = 0;
  let installerBillCount = 0;
  let trueUpCount = 0;
  let commissionLedgerCount = 0;
  if (jobId) {
    const [pos, labor, bills, trueUps, commissions] = await Promise.all([
      admin.from("purchase_orders").select("id, status, items:po_items(received_qty)").eq("job_id", jobId),
      admin.from("job_labor").select("id", { count: "exact", head: true }).eq("job_id", jobId),
      admin.from("installer_bills").select("id", { count: "exact", head: true }).eq("job_id", jobId),
      admin.from("job_true_ups").select("id", { count: "exact", head: true }).eq("job_id", jobId),
      admin.from("job_commission_ledger").select("id", { count: "exact", head: true }).eq("job_id", jobId),
    ]);
    if (pos.error || labor.error || bills.error || trueUps.error || commissions.error) {
      orderDeleteDenied(ORDER_KEPT);
    }
    draftPoIds = (pos.data ?? []).map((po) => po.id as string);
    purchaseOrders = (pos.data ?? []).map((po) => ({
      status: (po.status as string | null) ?? null,
      receivedQty: receivedQty(
        (po.items as { received_qty?: number | string | null }[] | null) ?? null,
      ),
    }));
    jobLaborCount = labor.count ?? 0;
    installerBillCount = bills.count ?? 0;
    trueUpCount = trueUps.count ?? 0;
    commissionLedgerCount = commissions.count ?? 0;
  }

  const decision = orderDestructionBlocker({
    invoices,
    purchaseOrders,
    jobLaborCount,
    installerBillCount,
    trueUpCount,
    commissionLedgerCount,
  });
  if (!decision.ok) orderDeleteDenied(decision.block.message);

  if (invoiceIds.length) {
    const { error } = await admin.from("invoices").delete().in("id", invoiceIds);
    if (error) {
      orderDeleteDenied(
        deleteErrorPreservesHistory(error.message)
          ? "This order was not deleted. Posted invoice or payment history is still on the books."
          : "This order was not deleted. A draft invoice could not be removed, so the order was kept.",
      );
    }
  }

  if (jobId) {
    if (draftPoIds.length) {
      const { error } = await admin.from("purchase_orders").delete().in("id", draftPoIds);
      if (error) {
        orderDeleteDenied(
          "Draft invoices with no payment history were removed, but a purchase order could not be deleted. The order was kept.",
        );
      }
    }

    const { error: jobError } = await admin.from("jobs").delete().eq("id", jobId);
    if (jobError) {
      orderDeleteDenied(
        "Untouched draft paperwork was removed, but the warehouse job could not be deleted. The order was kept.",
      );
    }
  }

  const { error: itemError } = await admin.from("order_items").delete().eq("order_id", orderId);
  if (itemError) {
    orderDeleteDenied("The order paperwork could not be removed. Check the order and try again.");
  }
  const { error: orderDeleteError } = await admin.from("orders").delete().eq("id", orderId);
  if (orderDeleteError) {
    orderDeleteDenied("The order could not be removed. Check the order and try again.");
  }

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

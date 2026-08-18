"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";

/** One cut, as the customer measured it. */
export interface OrderCut {
  widthFt: number;
  lengthFt: number;
  lengthIn: number;
}
export interface OrderSubmissionItem {
  productId: string | null;
  description: string;
  color: string;
  style: string;
  quantity: number;
  unit: string;
  cutNotes: string;
  /** The same cuts as data. cutNotes stays for older readers. */
  cuts: OrderCut[];
  retailPrice: number; // 0 if not a catalog item
  requestedPrice: number; // 0 if the customer didn't request a different price
}
export interface OrderSubmission {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** ISO yyyy-mm-dd. When they need the material. */
  dateNeeded: string;
  notes: string;
  items: OrderSubmissionItem[];
}
export interface OrderResult {
  error: string | null;
  ok?: boolean;
}

type DB =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createAdminClient>;

/** Keep only cuts that state a real length — a blank row is not a measurement. */
function cleanCuts(cuts: OrderCut[] | undefined) {
  const out = (cuts ?? [])
    .map((c) => ({
      width_ft: Number(c.widthFt) || 0,
      length_ft: Number(c.lengthFt) || 0,
      length_in: Number(c.lengthIn) || 0,
    }))
    .filter((c) => c.width_ft > 0 && (c.length_ft > 0 || c.length_in > 0));
  return out.length ? out : null;
}

/** A date the customer typed, or null. Never a date we invented for them. */
function cleanDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cleanItems(items: OrderSubmissionItem[]) {
  return items
    .filter((i) => i.description?.trim() || i.productId)
    .map((i, position) => ({
      product_id: i.productId || null,
      position,
      description: i.description?.trim() || "",
      color: i.color?.trim() || null,
      style: i.style?.trim() || null,
      quantity: Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : null,
      unit: i.unit?.trim() || "sq yd",
      cut_notes: i.cutNotes?.trim() || null,
      cuts: cleanCuts(i.cuts),
      retail_price:
        Number.isFinite(i.retailPrice) && i.retailPrice > 0 ? i.retailPrice : null,
      requested_price:
        Number.isFinite(i.requestedPrice) && i.requestedPrice > 0
          ? i.requestedPrice
          : null,
    }));
}

async function insertOrder(
  db: DB,
  order: Record<string, unknown>,
  items: ReturnType<typeof cleanItems>,
): Promise<{ id: string } | null> {
  let { data, error } = await db
    .from("orders")
    .insert(order)
    .select("id")
    .single();
  if (error) {
    // Retry without date_needed in case migration 0148 hasn't been run yet.
    // A customer's order must never be lost to a column we added.
    const { date_needed, ...rest } = order;
    if (date_needed !== undefined) {
      ({ data, error } = await db.from("orders").insert(rest).select("id").single());
    }
  }
  if (error || !data) return null;
  if (items.length) {
    const rows = items.map((it) => ({ ...it, order_id: data.id }));
    const { error: itErr } = await db.from("order_items").insert(rows);
    if (itErr) {
      // Same idea for the item columns: prices (0064) and cuts (0148). The
      // cut_notes text is written either way, so nothing is actually lost.
      const stripped = rows.map(
        ({ retail_price, requested_price, cuts, ...rest }) => rest,
      );
      await db.from("order_items").insert(stripped);
    }
  }
  return { id: data.id as string };
}

async function notifyOwnerNewOrder(
  who: string,
  itemCount: number,
  dateNeeded: string | null,
): Promise<void> {
  // When they need it belongs in the subject line — it is the one thing that
  // decides whether this is opened now or after lunch.
  const when = dateNeeded
    ? new Date(`${dateNeeded}T12:00:00`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  await sendEmail({
    to: ownerEmail(),
    subject: `🧾 New order to review — ${who}${when ? ` · needs it ${when}` : ""}`,
    html: emailLayout(
      "New order submitted",
      `<p><strong>${who}</strong> submitted an order (${itemCount} item${itemCount === 1 ? "" : "s"}).
        ${when ? `They need it by <strong>${when}</strong>.` : "They didn't give a date."}</p>
       <p>Review it and approve to send it to the warehouse for cutting.</p>`,
      { label: "Review orders", url: `${siteUrl()}/orders` },
    ),
  });
}

/** Public order form (no login). Runs elevated; requires name + phone. */
export async function submitPublicOrder(
  input: OrderSubmission,
): Promise<OrderResult> {
  const name = input.contactName?.trim();
  const phone = input.contactPhone?.trim();
  if (!name) return { error: "Please enter your name." };
  if (!phone) return { error: "Please enter a phone number so we can reach you." };
  const items = cleanItems(input.items);
  if (!items.length)
    return { error: "Add at least one item to your order." };

  const admin = createAdminClient() as unknown as DB;
  const res = await insertOrder(
    admin,
    {
      contact_name: name,
      contact_phone: phone,
      contact_email: input.contactEmail?.trim() || null,
      source: "public",
      status: "submitted",
      date_needed: cleanDate(input.dateNeeded),
      notes: input.notes?.trim() || null,
    },
    items,
  );
  if (!res) return { error: "Couldn't submit your order. Please try again." };
  await notifyOwnerNewOrder(name, items.length, cleanDate(input.dateNeeded));
  revalidatePath("/orders");
  return { error: null, ok: true };
}

/** Portal order form (logged-in trade account). */
export async function submitPortalOrder(
  input: OrderSubmission,
): Promise<OrderResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in to place an order." };
  const { data: me } = await supabase
    .from("profiles")
    .select("customer_id, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  const customerId = me?.customer_id as string | null;
  if (!customerId)
    return { error: "Your account isn't linked to a customer yet — contact us." };

  const items = cleanItems(input.items);
  if (!items.length) return { error: "Add at least one item to your order." };

  const res = await insertOrder(
    supabase as DB,
    {
      customer_id: customerId,
      contact_name: (me?.full_name as string) || input.contactName?.trim() || null,
      contact_phone: input.contactPhone?.trim() || null,
      contact_email: (me?.email as string) || input.contactEmail?.trim() || null,
      source: "portal",
      status: "submitted",
      date_needed: cleanDate(input.dateNeeded),
      notes: input.notes?.trim() || null,
      created_by: user.id,
    },
    items,
  );
  if (!res) return { error: "Couldn't submit your order. Please try again." };
  await notifyOwnerNewOrder(
    (me?.full_name as string) || "A trade account",
    items.length,
    cleanDate(input.dateNeeded),
  );
  revalidatePath("/orders");
  revalidatePath("/portal");
  return { error: null, ok: true };
}

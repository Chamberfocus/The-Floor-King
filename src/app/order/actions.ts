"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";

export interface OrderSubmissionItem {
  productId: string | null;
  description: string;
  color: string;
  style: string;
  quantity: number;
  unit: string;
  cutNotes: string;
  retailPrice: number; // 0 if not a catalog item
  requestedPrice: number; // 0 if the customer didn't request a different price
}
export interface OrderSubmission {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
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
  const { data, error } = await db
    .from("orders")
    .insert(order)
    .select("id")
    .single();
  if (error || !data) return null;
  if (items.length) {
    const rows = items.map((it) => ({ ...it, order_id: data.id }));
    const { error: itErr } = await db.from("order_items").insert(rows);
    if (itErr) {
      // Retry without the price columns in case migration 0064 isn't applied
      // yet — so order submission never breaks.
      const stripped = rows.map(
        ({ retail_price, requested_price, ...rest }) => rest,
      );
      await db.from("order_items").insert(stripped);
    }
  }
  return { id: data.id as string };
}

async function notifyOwnerNewOrder(
  who: string,
  itemCount: number,
): Promise<void> {
  await sendEmail({
    to: ownerEmail(),
    subject: `🧾 New order to review — ${who}`,
    html: emailLayout(
      "New order submitted",
      `<p><strong>${who}</strong> submitted an order (${itemCount} item${itemCount === 1 ? "" : "s"}). Review it and approve to send it to the warehouse for cutting.</p>`,
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
      notes: input.notes?.trim() || null,
    },
    items,
  );
  if (!res) return { error: "Couldn't submit your order. Please try again." };
  await notifyOwnerNewOrder(name, items.length);
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
      notes: input.notes?.trim() || null,
      created_by: user.id,
    },
    items,
  );
  if (!res) return { error: "Couldn't submit your order. Please try again." };
  await notifyOwnerNewOrder(
    (me?.full_name as string) || "A trade account",
    items.length,
  );
  revalidatePath("/orders");
  revalidatePath("/portal");
  return { error: null, ok: true };
}

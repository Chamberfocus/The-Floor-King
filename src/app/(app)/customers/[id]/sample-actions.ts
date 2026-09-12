"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendEmail, emailLayout, siteUrl } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import type { MessageSendResult } from "@/lib/message-send";
import { getBusinessSettings } from "@/lib/data/business-settings";

type Result = { error: string | null; notify?: MessageSendResult };

function revalidateCustomer(customerId: string | null | undefined) {
  if (customerId) revalidatePath(`/customers/${customerId}`);
  revalidatePath("/samples");
}

async function customerIdForCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  checkoutId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("sample_checkouts")
    .select("customer_id")
    .eq("id", checkoutId)
    .maybeSingle();
  return (data?.customer_id as string) ?? null;
}

/** Check out one or more samples to a customer, with a due date. Texts/emails
 *  the customer a confirmation and logs it on their file. */
export async function checkoutSamples(input: {
  customerId: string;
  items: { label: string; productId: string | null; qty: number }[];
  dueDate: string;
  deposit?: number | null;
  notes?: string | null;
}): Promise<Result> {
  if (!input.customerId) return { error: "Missing customer." };
  const items = (input.items ?? []).filter((i) => i.label?.trim());
  if (!items.length) return { error: "Add at least one sample." };
  if (!input.dueDate) return { error: "Set a return-by date." };

  const supabase = await createClient();

  // Enforce the per-customer "max samples out" limit (0 = no limit).
  const settings = await getBusinessSettings();
  const maxOut = Number(settings.sample_max_out) || 0;
  const adding = items.reduce(
    (s, i) => s + Math.max(1, Math.round(Number(i.qty) || 1)),
    0,
  );
  if (maxOut > 0) {
    const { data: openCos } = await supabase
      .from("sample_checkouts")
      .select("items:sample_checkout_items(qty)")
      .eq("customer_id", input.customerId)
      .eq("status", "out");
    const currentOut = (openCos ?? []).reduce(
      (s, c) =>
        s +
        ((c as { items?: { qty: number }[] }).items ?? []).reduce(
          (t, i) => t + (Number(i.qty) || 0),
          0,
        ),
      0,
    );
    if (currentOut + adding > maxOut) {
      return {
        error: `That would put ${currentOut + adding} samples out — the limit is ${maxOut}. Return some first, or raise the limit in Settings → Samples.`,
      };
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: co, error } = await supabase
    .from("sample_checkouts")
    .insert({
      customer_id: input.customerId,
      due_date: input.dueDate,
      deposit: input.deposit ?? null,
      notes: input.notes?.trim() || null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !co) {
    return { error: error?.message || "Couldn't start the checkout." };
  }

  const rows = items.map((i) => ({
    checkout_id: co.id,
    product_id: i.productId || null,
    label: i.label.trim(),
    qty: Math.max(1, Math.round(Number(i.qty) || 1)),
  }));
  const { error: itErr } = await supabase.from("sample_checkout_items").insert(rows);
  if (itErr) return { error: itErr.message };

  // Confirmation to the customer + activity log.
  const { data: cust } = await supabase
    .from("customers")
    .select("full_name, email, phone")
    .eq("id", input.customerId)
    .maybeSingle();
  const list = items
    .map((i) => `${Number(i.qty) > 1 ? `${i.qty}× ` : ""}${i.label.trim()}`)
    .join(", ");
  const dueNice = new Date(`${input.dueDate}T12:00:00`).toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );
  let notify: MessageSendResult = {
    status: "not_attempted",
    reason: "No email or phone on file.",
  };
  if (cust?.email) {
    notify = await sendEmail({
      to: cust.email as string,
      subject: "Your flooring samples — please return by " + dueNice,
      html: emailLayout(
        "Samples checked out",
        `<p>Hi ${(cust.full_name as string)?.split(" ")[0] ?? "there"},</p>
         <p>Thanks for borrowing samples from Cleveland Floor King. Here's what you have:</p>
         <ul>${rows.map((r) => `<li>${r.qty > 1 ? `${r.qty}× ` : ""}${r.label}</li>`).join("")}</ul>
         <p>Please return them by <strong>${dueNice}</strong>. We'll send a friendly reminder as the date nears.</p>`,
        { label: "View my project", url: `${siteUrl()}/portal` },
      ),
    });
  } else if (cust?.phone) {
    notify = await sendSms(
      cust.phone as string,
      `Cleveland Floor King: you checked out samples (${list}). Please return by ${dueNice}. Thanks!`,
    );
  }
  if (cust?.phone && cust?.email) {
    await sendSms(
      cust.phone as string,
      `Cleveland Floor King: you checked out samples (${list}). Please return by ${dueNice}. Thanks!`,
    );
  }
  await supabase.from("activities").insert({
    customer_id: input.customerId,
    user_id: user?.id ?? null,
    type: "note",
    body: `Checked out samples (due ${dueNice}): ${list}`,
  });

  revalidateCustomer(input.customerId);
  return { error: null, notify };
}

export async function returnCheckout(checkoutId: string): Promise<Result> {
  if (!checkoutId) return { error: "Missing checkout." };
  const supabase = await createClient();
  const customerId = await customerIdForCheckout(supabase, checkoutId);
  await supabase
    .from("sample_checkout_items")
    .update({ returned: true })
    .eq("checkout_id", checkoutId);
  const { error } = await supabase
    .from("sample_checkouts")
    .update({ status: "returned", returned_at: new Date().toISOString() })
    .eq("id", checkoutId);
  if (error) return { error: error.message };
  revalidateCustomer(customerId);
  return { error: null };
}

/** Return a single sample; if it was the last one out, close the checkout. */
export async function returnSampleItem(itemId: string): Promise<Result> {
  if (!itemId) return { error: "Missing item." };
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("sample_checkout_items")
    .select("checkout_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item?.checkout_id) return { error: "Sample not found." };
  await supabase.from("sample_checkout_items").update({ returned: true }).eq("id", itemId);
  const { data: remaining } = await supabase
    .from("sample_checkout_items")
    .select("id")
    .eq("checkout_id", item.checkout_id as string)
    .eq("returned", false);
  if (!remaining?.length) {
    await supabase
      .from("sample_checkouts")
      .update({ status: "returned", returned_at: new Date().toISOString() })
      .eq("id", item.checkout_id as string);
  }
  revalidateCustomer(await customerIdForCheckout(supabase, item.checkout_id as string));
  return { error: null };
}

export async function extendCheckout(
  checkoutId: string,
  dueDate: string,
): Promise<Result> {
  if (!checkoutId || !dueDate) return { error: "Missing details." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sample_checkouts")
    .update({ due_date: dueDate, last_reminder_on: null })
    .eq("id", checkoutId);
  if (error) return { error: error.message };
  revalidateCustomer(await customerIdForCheckout(supabase, checkoutId));
  return { error: null };
}

export async function markCheckoutLost(checkoutId: string): Promise<Result> {
  if (!checkoutId) return { error: "Missing checkout." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("sample_checkouts")
    .update({ status: "lost" })
    .eq("id", checkoutId);
  if (error) return { error: error.message };
  revalidateCustomer(await customerIdForCheckout(supabase, checkoutId));
  return { error: null };
}

/** FormData wrapper for the staff Samples board's "Mark returned" button. */
export async function returnCheckoutAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id === "string" && id) await returnCheckout(id);
}

export async function deleteCheckout(checkoutId: string): Promise<Result> {
  if (!checkoutId) return { error: "Missing checkout." };
  const supabase = await createClient();
  const customerId = await customerIdForCheckout(supabase, checkoutId);
  const { error } = await supabase.from("sample_checkouts").delete().eq("id", checkoutId);
  if (error) return { error: error.message };
  revalidateCustomer(customerId);
  return { error: null };
}

"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { customerIsArchived } from "@/lib/customer-operational";
import { quoteText } from "@/lib/in-home-close";
import { sendSms } from "@/lib/sms";
import { emailLayout, sendEmail, siteUrl } from "@/lib/notify";
import { describeMessageSend } from "@/lib/message-send";
import { COMPANY_NAME } from "@/lib/nav";
import { advanceFromAutoAction } from "@/lib/workflow-engine";
import { onEstimateSentOps } from "@/lib/data/ops-automation";
import {
  cleanEstimateEmail,
  estimateEmailRecipients,
  estimatePhoneDigits,
  estimatePhoneRecipients,
  isEstimateEmail,
  isEstimatePhone,
} from "@/lib/estimate-recipients";
import type { UserRole } from "@/lib/types";

const SEND_ROLES: UserRole[] = ["admin", "office", "sales_manager", "salesman"];

export interface EstimateSendPreviewInput {
  estimateId: string;
  email: string;
  phone: string;
  extraEmails: string;
  extraPhones: string;
  sendEmail: boolean;
  sendText: boolean;
  /** Write the primary email and phone onto the customer. Extras stay on this send. */
  saveOnCustomer: boolean;
}

export interface EstimateSendPreviewResult {
  ok: boolean;
  message: string;
}

function estimateEmailHtml(firstName: string, title: string | null): string {
  const who = firstName.trim() || "there";
  const named = title?.trim() ? ` &ldquo;${title.trim()}&rdquo;` : "";
  return `<p>Hi ${who},</p>
         <p>Thank you so much for the opportunity to earn your business — we truly appreciate it and would be delighted to bring your floors to life.</p>
         <p>Your estimate${named} is ready to review. Tap below to view it and approve, decline, or request changes — whatever works best for you.</p>
         <p>We can't wait to work with you!</p>`;
}

/**
 * Send the estimate only after the salesperson has seen the preview and
 * confirmed each address. A failed send does not mark a draft as sent.
 */
export async function sendEstimatePreview(
  input: EstimateSendPreviewInput,
): Promise<EstimateSendPreviewResult> {
  const id = input.estimateId?.trim() ?? "";
  if (!id) return { ok: false, message: "Missing estimate." };
  try {
    await assertRole(SEND_ROLES);
  } catch {
    return { ok: false, message: "You don’t have permission to send this estimate." };
  }
  if (!input.sendEmail && !input.sendText) {
    return { ok: false, message: "Choose email, text, or both." };
  }

  const emails = input.sendEmail
    ? estimateEmailRecipients(input.email, input.extraEmails)
    : { emails: [], rejected: [] };
  const phones = input.sendText
    ? estimatePhoneRecipients(input.phone, input.extraPhones)
    : { phones: [], rejected: [] };
  const rejected = [...emails.rejected, ...phones.rejected];
  if (input.sendEmail && emails.emails.length === 0) {
    return { ok: false, message: "Enter an email address before sending the email." };
  }
  if (input.sendText && phones.phones.length === 0) {
    return { ok: false, message: "Enter a phone number before sending the text." };
  }
  if (rejected.length) {
    return {
      ok: false,
      message: `Check these recipients: ${rejected.join(", ")}.`,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: est } = await supabase
    .from("estimates")
    .select(
      "id, status, title, customer_id, customer:customers(full_name, email, phone, cancelled_at, assigned_to, workflow_owner_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!est) return { ok: false, message: "Estimate was not found." };

  const cust = est.customer as unknown as {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    cancelled_at: string | null;
    assigned_to: string | null;
    workflow_owner_id: string | null;
  } | null;
  if (customerIsArchived(cust?.cancelled_at)) {
    return { ok: false, message: "This customer is archived." };
  }
  if (est.status === "declined") {
    return { ok: false, message: "This estimate was declined." };
  }
  const { count, error: optionErr } = await supabase
    .from("estimate_options")
    .select("id", { count: "exact", head: true })
    .eq("estimate_id", id);
  if (optionErr || !count) {
    return { ok: false, message: "Add a priced option before sending this estimate." };
  }

  const customerId = (est.customer_id as string | null) ?? null;
  if (input.saveOnCustomer && customerId) {
    const patch: { email?: string; phone?: string } = {};
    const nextEmail = cleanEstimateEmail(input.email);
    const nextPhone = input.phone.trim();
    if (isEstimateEmail(nextEmail) && nextEmail !== cleanEstimateEmail(cust?.email ?? "")) {
      patch.email = nextEmail;
    }
    if (
      isEstimatePhone(nextPhone) &&
      estimatePhoneDigits(nextPhone) !== estimatePhoneDigits(cust?.phone ?? "")
    ) {
      patch.phone = nextPhone;
    }
    if (Object.keys(patch).length) {
      const { error } = await supabase.from("customers").update(patch).eq("id", customerId);
      if (error) return { ok: false, message: "The customer email and phone did not save." };
    }
  }

  const first = cust?.full_name?.split(" ")[0] ?? "there";
  const url = `${siteUrl()}/portal/estimates/${id}`;
  const notes: string[] = [];
  let emailOk = 0;
  let textOk = 0;

  if (input.sendEmail) {
    for (const to of emails.emails) {
      const sent = await sendEmail({
        to,
        subject: "Your estimate from Cleveland Floor King 🎉",
        html: emailLayout(
          "Thank you for the opportunity!",
          estimateEmailHtml(first, (est.title as string | null) ?? null),
          { label: "View & approve your estimate", url },
          { preheader: "Thank you for the opportunity — your estimate is ready to review." },
        ),
        tags: [
          { name: "category", value: "estimate" },
          { name: "estimate_id", value: id },
        ],
      });
      if (sent.status === "success") emailOk += 1;
      else notes.push(`${to}: ${describeMessageSend(sent)}`);
    }
  }
  if (input.sendText) {
    const body = quoteText({ firstName: first, company: COMPANY_NAME, url });
    for (const to of phones.phones) {
      const sent = await sendSms(to, body);
      if (sent.status === "success") textOk += 1;
      else notes.push(`${to}: ${describeMessageSend(sent)}`);
    }
  }

  const anySent = emailOk > 0 || textOk > 0;
  if (!anySent) {
    return {
      ok: false,
      message: notes[0] ?? "Nothing was sent. The estimate is still a draft.",
    };
  }

  let statusNote = "";
  if (est.status === "draft") {
    const sentAt = new Date().toISOString();
    const textOnly = emailOk === 0 && textOk > 0;
    const { error } = await supabase
      .from("estimates")
      .update({
        status: "sent",
        sent_at: sentAt,
        thankyou_sent_at: textOnly ? sentAt : null,
      })
      .eq("id", id)
      .eq("status", "draft");
    if (error) {
      statusNote = " The messages went out, but the estimate is still a draft.";
    } else if (customerId) {
      await advanceFromAutoAction(customerId, "build_quote");
      await onEstimateSentOps({
        estimateId: id,
        customerId,
        assignedTo: cust?.workflow_owner_id ?? cust?.assigned_to ?? null,
        actorId: user?.id ?? null,
        title: (est.title as string | null) ?? null,
        db: supabase,
      });
    }
  }

  revalidatePath(`/estimates/${id}`);
  revalidatePath(`/portal/estimates/${id}`);
  revalidatePath("/estimates");
  revalidatePath("/client-status");
  revalidatePath("/dashboard");
  if (customerId) revalidatePath(`/customers/${customerId}`);

  const sentBits = [
    emailOk ? `${emailOk} email${emailOk === 1 ? "" : "s"}` : "",
    textOk ? `${textOk} text${textOk === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const lead = `Sent ${sentBits.join(" and ")}.`;
  return {
    ok: notes.length === 0 && !statusNote,
    message: `${notes.length ? `${lead} Some recipients did not go through: ${notes.join(" ")}` : lead}${statusNote}`,
  };
}

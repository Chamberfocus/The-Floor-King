import { describeMessageSend, type MessageSendResult } from "@/lib/message-send";
import { emailLayout, ownerEmail, sendEmail, siteUrl } from "@/lib/notify";
import { sendSms } from "@/lib/sms";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function shortName(name: string): string {
  const trimmed = name.trim() || "A new lead";
  return trimmed.length > 40 ? `${trimmed.slice(0, 37)}…` : trimmed;
}

export async function notifySalespersonOfLead(input: {
  toEmail: string | null;
  toPhone: string | null;
  customerName: string;
  customerId: string;
}): Promise<string> {
  const name = input.customerName.trim() || "A new lead";
  const url = `${siteUrl()}/customers/${input.customerId}`;
  const email: MessageSendResult = input.toEmail
    ? await sendEmail({
        to: input.toEmail,
        subject: `New lead: ${name}`,
        html: emailLayout(
          "A lead was assigned to you",
          `<p><strong>${esc(name)}</strong> is now your lead.</p><p>Accept it in Floor King before you write the estimate. Add a note if you need one.</p>`,
          { label: "Open the lead", url },
          { preheader: `${name} is waiting for you to accept.` },
        ),
      })
    : { status: "not_attempted", reason: "No email on the salesperson." };
  const sms: MessageSendResult = input.toPhone
    ? await sendSms(
        input.toPhone,
        `Floor King: ${shortName(name)} was assigned to you. Accept the lead: ${url}`,
      )
    : { status: "not_attempted", reason: "No phone on the salesperson." };
  return `Email ${describeMessageSend(email)}. Text ${describeMessageSend(sms)}.`;
}

export async function notifyOwnerLeadDeclined(input: {
  customerName: string;
  customerId: string;
  salespersonName: string;
  note: string;
}): Promise<void> {
  const name = input.customerName.trim() || "A lead";
  const url = `${siteUrl()}/customers/${input.customerId}`;
  await sendEmail({
    to: ownerEmail(),
    subject: `Lead declined: ${name}`,
    html: emailLayout(
      "A salesperson declined a lead",
      `<p><strong>${esc(input.salespersonName || "A salesperson")}</strong> declined <strong>${esc(name)}</strong>.</p><p>${esc(input.note)}</p><p>The lead is back on your list so you can assign it again.</p>`,
      { label: "Open the lead", url },
    ),
  });
}

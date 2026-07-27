/**
 * Email notifications via Resend. SERVER ONLY.
 * No-ops gracefully until RESEND_API_KEY is configured, so the app keeps
 * working without email set up.
 */
import { COMPANY_NAME } from "@/lib/nav";

export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://floorking-crm.vercel.app"
  );
}

export function ownerEmail(): string {
  return process.env.NOTIFY_OWNER_EMAIL || "karam@clevelandfloorking.com";
}

// Brand palette for customer emails — a clean, premium, welcoming look that
// renders consistently across email clients (all styles inline, table layout).
const BRAND = "#123a63"; // deep professional blue
const BRAND_DARK = "#0d2c4d";
const TINT = "#eef4fb"; // soft brand tint for detail cards
const INK = "#1f2937";
const MUTED = "#6b7280";

/**
 * A styled details card for the key facts of a message — dates, arrival windows,
 * addresses. Drop it into an emailLayout body. Each row is label → value; the
 * value renders bold so an arrival window is impossible to miss.
 */
export function emailInfoCard(
  rows: { label: string; value: string }[],
  opts?: { title?: string },
): string {
  const body = rows
    .filter((r) => r.value)
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 0;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;">${r.label}</td>
        <td style="padding:6px 0 6px 16px;font-size:15px;font-weight:700;color:${INK};text-align:right;">${r.value}</td>
      </tr>`,
    )
    .join("");
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TINT};border:1px solid #d7e3f2;border-radius:12px;margin:20px 0;">
    <tr><td style="padding:16px 20px;">
      ${opts?.title ? `<div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${BRAND};margin-bottom:6px;">${opts.title}</div>` : ""}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
    </td></tr>
  </table>`;
}

/**
 * Wrap content in a polished, welcoming branded HTML shell. Table-based and
 * fully inline-styled so it looks right in Gmail, Outlook, and Apple Mail.
 * Backward compatible: (heading, bodyHtml, cta?) still works; `opts.preheader`
 * sets the inbox preview line.
 */
export function emailLayout(
  heading: string,
  bodyHtml: string,
  cta?: { label: string; url: string },
  opts?: { preheader?: string },
): string {
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;"><tr><td style="border-radius:10px;background:${BRAND};">
         <a href="${cta.url}" style="background:${BRAND};color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;display:inline-block;font-weight:700;font-size:15px;">${cta.label}</a>
       </td></tr></table>`
    : "";
  const preheader = opts?.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>`
    : "";
  return `
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f4f8;margin:0;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="background:${BRAND};background-image:linear-gradient(135deg,${BRAND},${BRAND_DARK});padding:22px 32px;">
          <div style="color:#ffffff;font-weight:800;font-size:20px;letter-spacing:.01em;">${COMPANY_NAME}</div>
          <div style="color:#bcd3ec;font-size:12px;margin-top:2px;letter-spacing:.06em;text-transform:uppercase;">Flooring done right</div>
        </td></tr>
        <tr><td style="padding:30px 32px 8px;">
          <h1 style="font-size:22px;line-height:1.3;margin:0 0 14px;color:${INK};font-weight:800;">${heading}</h1>
          <div style="font-size:15px;line-height:1.65;color:#374151;">${bodyHtml}</div>
          ${button}
        </td></tr>
        <tr><td style="padding:22px 32px 28px;">
          <hr style="border:none;border-top:1px solid #e8ecf1;margin:0 0 16px;">
          <div style="font-size:13px;line-height:1.6;color:${MUTED};">
            <div style="font-weight:700;color:${INK};">${COMPANY_NAME}</div>
            <div>Questions? Just reply to this email — we're happy to help.</div>
            <div style="margin-top:2px;">${ownerEmail()}</div>
          </div>
        </td></tr>
      </table>
      <div style="font-size:11px;color:#9aa4b2;margin-top:16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">© ${COMPANY_NAME}</div>
    </td></tr>
  </table>`;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  tags?: { name: string; value: string }[];
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from =
    process.env.NOTIFY_FROM_EMAIL ||
    `${COMPANY_NAME} <onboarding@resend.dev>`;
  if (!key || !opts.to) return false;
  // Master switches: never email a customer while customer notifications are off.
  const { notifyAllowed } = await import("@/lib/notify-gate");
  if (!(await notifyAllowed({ email: opts.to }))) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.tags ? { tags: opts.tags } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

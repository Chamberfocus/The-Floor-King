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

/** Wrap content in a simple branded HTML shell. */
export function emailLayout(
  heading: string,
  bodyHtml: string,
  cta?: { label: string; url: string },
): string {
  const button = cta
    ? `<p style="margin:24px 0;">
         <a href="${cta.url}" style="background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600;">${cta.label}</a>
       </p>`
    : "";
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
    <div style="font-weight:700;font-size:18px;margin-bottom:16px;">${COMPANY_NAME}</div>
    <h1 style="font-size:20px;margin:0 0 12px;">${heading}</h1>
    <div style="font-size:15px;line-height:1.6;color:#374151;">${bodyHtml}</div>
    ${button}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <div style="font-size:12px;color:#9ca3af;">${COMPANY_NAME}</div>
  </div>`;
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

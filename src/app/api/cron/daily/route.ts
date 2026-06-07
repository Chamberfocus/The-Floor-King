import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { triggerImportProcessing } from "@/lib/import-worker";

export const dynamic = "force-dynamic";

/**
 * Scheduled jobs (Vercel Cron):
 *  - Thank-you email ~2h after an estimate is sent.
 *  - Day-before reminder for installs scheduled tomorrow.
 * Protected by CRON_SECRET (Vercel sends it as a Bearer token).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ ok: false, error: "no service key" });
  }

  const now = Date.now();
  let thankyou = 0;
  let reminders = 0;

  // --- 2-hour thank-you ---
  const cutoff = new Date(now - 2 * 3600 * 1000).toISOString();
  const { data: ests } = await admin
    .from("estimates")
    .select("id, title, customer:customers(full_name, email)")
    .is("thankyou_sent_at", null)
    .not("sent_at", "is", null)
    .lte("sent_at", cutoff);
  for (const e of ests ?? []) {
    const cust = e.customer as unknown as {
      full_name: string | null;
      email: string | null;
    } | null;
    if (cust?.email) {
      await sendEmail({
        to: cust.email,
        subject: "Thank you from Cleveland Floor King",
        html: emailLayout(
          "Thank you for the opportunity",
          `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
           <p>Thank you for the opportunity to earn your business. Your estimate is ready to review — if you have any questions at all, please don't hesitate to reach out. We're happy to help.</p>`,
          { label: "View your estimate", url: `${siteUrl()}/portal` },
        ),
      });
    }
    await admin
      .from("estimates")
      .update({ thankyou_sent_at: new Date(now).toISOString() })
      .eq("id", e.id);
    thankyou += 1;
  }

  // --- Day-before install reminder ---
  const tomorrow = new Date(now + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, title, assigned_to, customer:customers(full_name, email, phone)")
    .eq("status", "scheduled")
    .eq("scheduled_date", tomorrow)
    .is("reminder_sent_at", null);
  for (const j of jobs ?? []) {
    const cust = j.customer as unknown as {
      full_name: string | null;
      email: string | null;
      phone: string | null;
    } | null;
    const recipients = new Set<string>([ownerEmail()]);
    if (j.assigned_to) {
      const { data: inst } = await admin
        .from("profiles")
        .select("email")
        .eq("id", j.assigned_to as string)
        .maybeSingle();
      if (inst?.email) recipients.add(inst.email as string);
    }
    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `Reminder: install tomorrow — ${cust?.full_name ?? "job"}`,
        html: emailLayout(
          "Install scheduled tomorrow",
          `<p>Reminder: the install${j.title ? ` "${j.title}"` : ""}${cust?.full_name ? ` for ${cust.full_name}` : ""} is scheduled for <strong>tomorrow</strong>.</p>`,
          { label: "Open job", url: `${siteUrl()}/jobs/${j.id}` },
        ),
      });
    }
    if (cust?.email) {
      await sendEmail({
        to: cust.email,
        subject: "Your flooring install is tomorrow",
        html: emailLayout(
          "See you tomorrow!",
          `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
           <p>Just a friendly reminder that your flooring installation is scheduled for <strong>tomorrow</strong>. We look forward to it!</p>`,
        ),
      });
    }
    if (cust?.phone) {
      await sendSms(
        cust.phone,
        "Cleveland Floor King: your flooring installation is scheduled for tomorrow. See you then!",
      );
    }
    await admin
      .from("jobs")
      .update({ reminder_sent_at: new Date(now).toISOString() })
      .eq("id", j.id);
    reminders += 1;
  }

  // --- Review request after a completed job ---
  let reviews = 0;
  const { data: org } = await admin
    .from("org_settings")
    .select("google_review_url, company_name")
    .eq("id", "default")
    .maybeSingle();
  const reviewUrl = (org?.google_review_url as string | null)?.trim() || "";
  const company = (org?.company_name as string) || "Cleveland Floor King";
  if (reviewUrl) {
    // Ask ~2h after completion so the crew is gone but it's still same-day-ish.
    const doneCutoff = new Date(now - 2 * 3600 * 1000).toISOString();
    const { data: doneJobs } = await admin
      .from("jobs")
      .select("id, customer:customers(full_name, email, phone)")
      .eq("status", "completed")
      .is("review_request_sent_at", null)
      .not("completed_at", "is", null)
      .lte("completed_at", doneCutoff);
    for (const j of doneJobs ?? []) {
      const cust = j.customer as unknown as {
        full_name: string | null;
        email: string | null;
        phone: string | null;
      } | null;
      const first = cust?.full_name?.split(" ")[0] ?? "there";
      if (cust?.email) {
        await sendEmail({
          to: cust.email,
          subject: `How did we do? — ${company}`,
          html: emailLayout(
            "Thank you — we'd love your feedback",
            `<p>Hi ${first},</p>
             <p>Thank you for choosing ${company}! We hope you love your new floors.
             If you have a moment, a quick review would mean the world to us and
             helps other homeowners find us.</p>`,
            { label: "Leave a review", url: reviewUrl },
          ),
        });
      }
      if (cust?.phone) {
        await sendSms(
          cust.phone,
          `Thanks for choosing ${company}! We'd love a quick review: ${reviewUrl}`,
        );
      }
      await admin
        .from("jobs")
        .update({ review_request_sent_at: new Date(now).toISOString() })
        .eq("id", j.id);
      reviews += 1;
    }
  }

  // --- Safety net: resume any import job that stalled (e.g. a dropped trigger) ---
  let resumed = 0;
  const staleCutoff = new Date(now - 3 * 60 * 1000).toISOString();
  const { data: stalled } = await admin
    .from("import_jobs")
    .select("id")
    .in("status", ["queued", "processing"])
    .lt("updated_at", staleCutoff);
  for (const job of stalled ?? []) {
    await triggerImportProcessing(job.id as string);
    resumed += 1;
  }

  return NextResponse.json({ ok: true, thankyou, reminders, reviews, resumed });
}

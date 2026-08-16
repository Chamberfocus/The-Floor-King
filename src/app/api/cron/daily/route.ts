import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { sendSms } from "@/lib/sms";
import { triggerImportProcessing } from "@/lib/import-worker";
import { advanceToNamedStage } from "@/lib/workflow-engine";
import { invoiceTotals } from "@/lib/invoice-calc";
import {
  collectCatalogsOverSftp,
  feedsDue,
  fetchPricesOverRest,
  recordFeedRun,
  stagePriceImport,
} from "@/lib/data/supplier-feeds";

export const dynamic = "force-dynamic";
/**
 * This job was always long — thank-yous, reminders, stage advances, chasers —
 * and it now also signs in to supplier mailboxes, downloads price catalogs and
 * stages thousands of lines. On the default limit the feed collection is the
 * part that gets cut off, silently, after everything else has already run.
 */
export const maxDuration = 300;

/**
 * What a customer still owes across their open invoices. Uses the same
 * invoiceTotals the invoice screen does, so the cron can't disagree with what
 * the office is looking at.
 */
async function outstandingBalance(
  admin: ReturnType<typeof createAdminClient>,
  customerId: string,
): Promise<number> {
  const { data: invoices } = await admin
    .from("invoices")
    .select("id, tax_rate, status, items:invoice_items(quantity, rate), payments(amount)")
    .eq("customer_id", customerId)
    .neq("status", "void");

  let owed = 0;
  for (const inv of invoices ?? []) {
    const paid = ((inv.payments ?? []) as { amount: number }[]).reduce(
      (sum, p) => sum + (Number(p.amount) || 0),
      0,
    );
    const t = invoiceTotals(
      (inv.items ?? []) as Parameters<typeof invoiceTotals>[0],
      inv.tax_rate as number,
      paid,
    );
    if (t.balance > 0) owed += t.balance;
  }
  return Math.round(owed * 100) / 100;
}

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

  // --- 2-hour follow-up ---
  //
  // This used to repeat the send email almost word for word ("Thank you for the
  // opportunity to earn your business…"), so every customer got the same
  // message twice, two hours apart. It's now a light nudge — and it is SKIPPED
  // for anyone who has already opened the estimate, because chasing someone who
  // read it twenty minutes ago is noise, not service.
  const cutoff = new Date(now - 2 * 3600 * 1000).toISOString();
  const { data: ests } = await admin
    .from("estimates")
    .select("id, title, viewed_at, customer:customers(full_name, email)")
    .is("thankyou_sent_at", null)
    .not("sent_at", "is", null)
    .lte("sent_at", cutoff);
  for (const e of ests ?? []) {
    const cust = e.customer as unknown as {
      full_name: string | null;
      email: string | null;
    } | null;
    // Already read it? Then say nothing and close it out.
    const { count: opens } = await admin
      .from("estimate_events")
      .select("id", { count: "exact", head: true })
      .eq("estimate_id", e.id)
      .eq("kind", "viewed");
    const alreadyRead = (opens ?? 0) > 0 || e.viewed_at != null;

    if (cust?.email && !alreadyRead) {
      await sendEmail({
        to: cust.email,
        subject: "Did your estimate come through?",
        html: emailLayout(
          "Just checking it reached you",
          `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
           <p>We sent your estimate a little earlier today and wanted to make sure it landed — sometimes they end up in a spam folder.</p>
           <p>Any questions at all, just reply to this email or give us a call. No rush.</p>`,
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

  // --- Install day arrived → put the job In Progress -------------------------
  // Jobs sat on "scheduled" long after their install date because nothing moved
  // them; the crew is on site and the pipeline still says "waiting to install".
  // Forward-only, and it never touches a job somebody already advanced.
  let started = 0;
  let staleScheduled = 0;
  const todayStr = new Date(now).toISOString().slice(0, 10);
  // Look back a fortnight, not forever. A job whose install date passed weeks
  // ago is not "in progress" — it finished and nobody closed it out, and
  // labelling it in-progress would be a confident lie. Those are counted and
  // reported instead, so the backlog surfaces without being mislabelled.
  const lookback = new Date(now - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: due } = await admin
    .from("jobs")
    .select("id, customer_id, scheduled_date")
    .eq("status", "scheduled")
    .not("scheduled_date", "is", null)
    .lte("scheduled_date", todayStr);
  for (const j of due ?? []) {
    if ((j.scheduled_date as string) < lookback) {
      staleScheduled += 1;
      continue;
    }
    await admin.from("jobs").update({ status: "in_progress" }).eq("id", j.id as string);
    if (j.customer_id) {
      await advanceToNamedStage(j.customer_id as string, /in progress|in-progress/);
    }
    started += 1;
  }

  // --- Install finished but money still out → Collect Balance ----------------
  // Completing a job moves the customer to "Installed — Follow-up". If there is
  // still a balance, the job isn't really done — surface it as its own stage so
  // the last payment doesn't quietly age.
  let balanceChased = 0;
  const { data: finished } = await admin
    .from("jobs")
    .select("id, customer_id")
    .eq("status", "completed")
    .not("customer_id", "is", null);
  for (const j of finished ?? []) {
    const owed = await outstandingBalance(admin, j.customer_id as string);
    if (owed > 0.005) {
      await advanceToNamedStage(j.customer_id as string, /balance/);
      balanceChased += 1;
    }
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

  // --- Stuck-too-long alerts ---
  // A client past its stage's time limit alerts BOTH the current handler and its
  // salesperson (so a passed-down client never falls off the salesperson's
  // radar), and every admin (owner + Debbie) gets a full oversight digest.
  let nudges = 0;
  const { data: overdue } = await admin
    .from("customers")
    .select(
      "id, full_name, next_action_due, workflow_owner_id, assigned_to, stage:workflow_stages(name, next_action)",
    )
    .not("next_action_due", "is", null)
    .lt("next_action_due", new Date(now).toISOString());

  type StuckLead = { name: string; stage: string; action: string };
  const rowHtml = (l: StuckLead) =>
    `<li><strong>${l.name}</strong> — ${l.stage}: ${l.action}</li>`;

  // Admins (owner + Debbie) get the full digest; skip them in the per-person
  // alerts so they aren't double-emailed.
  const { data: adminProfs } = await admin
    .from("profiles")
    .select("id, email")
    .eq("role", "admin");
  const adminIds = new Set((adminProfs ?? []).map((p) => p.id as string));

  const allStuck: StuckLead[] = [];
  const byRecipient = new Map<string, StuckLead[]>();
  for (const c of overdue ?? []) {
    const stage = c.stage as unknown as {
      name: string | null;
      next_action: string | null;
    } | null;
    const lead: StuckLead = {
      name: (c.full_name as string) ?? "A customer",
      stage: stage?.name ?? "—",
      action: stage?.next_action ?? "Follow up",
    };
    allStuck.push(lead);
    // The current handler + the permanent salesperson (deduped).
    const recipients = new Set<string>();
    if (c.workflow_owner_id) recipients.add(c.workflow_owner_id as string);
    if (c.assigned_to) recipients.add(c.assigned_to as string);
    for (const uid of recipients) {
      if (adminIds.has(uid)) continue; // admins get the full digest instead
      const arr = byRecipient.get(uid) ?? [];
      arr.push(lead);
      byRecipient.set(uid, arr);
    }
  }

  for (const [uid, leads] of byRecipient) {
    const { data: prof } = await admin
      .from("profiles")
      .select("email")
      .eq("id", uid)
      .maybeSingle();
    if (!prof?.email) continue;
    await sendEmail({
      to: prof.email as string,
      subject: `${leads.length} client${leads.length === 1 ? "" : "s"} need your attention`,
      html: emailLayout(
        "Clients waiting on you",
        `<p>These clients are past their target time for the next step:</p>
         <ul>${leads.map(rowHtml).join("")}</ul>`,
        { label: "Open the pipeline", url: `${siteUrl()}/pipeline?mine=1&overdue=1` },
      ),
    });
    nudges += 1;
  }

  // Full oversight digest to each admin (owner + Debbie).
  if (allStuck.length) {
    for (const p of adminProfs ?? []) {
      if (!p.email) continue;
      await sendEmail({
        to: p.email as string,
        subject: `${allStuck.length} client${allStuck.length === 1 ? "" : "s"} stuck too long`,
        html: emailLayout(
          "Clients stuck too long — full view",
          `<p>These clients are past their stage's time limit across the whole team, so nothing falls through the cracks:</p>
           <ul>${allStuck.map(rowHtml).join("")}</ul>`,
          { label: "Open the pipeline", url: `${siteUrl()}/pipeline?overdue=1` },
        ),
      });
      nudges += 1;
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

  // --- Sample return reminders (text + email) ---
  let sampleReminders = 0;
  try {
    const { data: s } = await admin
      .from("business_settings")
      .select("sample_reminder_lead_days")
      .eq("id", "default")
      .maybeSingle();
    const lead = Number(s?.sample_reminder_lead_days) || 2;
    const startOfToday = new Date(new Date(now).toDateString()).getTime();
    const todayYmd = new Date(now).toISOString().slice(0, 10);
    const twoDaysAgo = new Date(now - 2 * 86400000).toISOString().slice(0, 10);

    const { data: cos } = await admin
      .from("sample_checkouts")
      .select(
        "id, due_date, last_reminder_on, customer:customers(full_name, email, phone), items:sample_checkout_items(label, qty)",
      )
      .eq("status", "out");

    for (const c of cos ?? []) {
      const due = c.due_date as string;
      const daysUntil = Math.round(
        (new Date(`${due}T00:00:00`).getTime() - startOfToday) / 86400000,
      );
      const last = (c.last_reminder_on as string | null) ?? null;
      // Only when due is within the lead window (or overdue), at most every 2 days.
      if (daysUntil > lead) continue;
      if (last && last > twoDaysAgo) continue;

      const cust = (
        Array.isArray(c.customer) ? c.customer[0] : c.customer
      ) as { full_name: string | null; email: string | null; phone: string | null } | null;
      const items = (c.items ?? []) as { label: string; qty: number }[];
      const list = items
        .map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${i.label}`)
        .join(", ");
      const when =
        daysUntil < 0
          ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue`
          : daysUntil === 0
            ? "due today"
            : `due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;

      if (cust?.email) {
        await sendEmail({
          to: cust.email,
          subject: `Reminder: your flooring samples are ${when}`,
          html: emailLayout(
            "Sample return reminder",
            `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
             <p>A friendly reminder to return the samples you borrowed (${list}) — they're <strong>${when}</strong>.</p>
             <p>Drop them by the showroom anytime, or reply if you need more time.</p>`,
            { label: "View my project", url: `${siteUrl()}/portal` },
          ),
        });
      }
      if (cust?.phone) {
        await sendSms(
          cust.phone,
          `Cleveland Floor King: your samples (${list}) are ${when}. Please return them, or reply if you need more time. Thanks!`,
        );
      }
      await admin
        .from("sample_checkouts")
        .update({ last_reminder_on: todayYmd })
        .eq("id", c.id as string);
      sampleReminders += 1;
    }
  } catch {
    /* sample_checkouts may not exist yet (migration 0052 not run) */
  }

  // --- Supplier price feeds ---
  //
  // Pull each live fcB2B connection that is due, and stage what comes back as a
  // DRAFT. The cron never changes a cost — a supplier raising prices overnight
  // has to cross a person's desk, because every estimate margin depends on it.
  let priceImports = 0;
  try {
    const feedDb = admin as unknown as Parameters<typeof feedsDue>[0];

    /** One email per staged catalog that actually moved a price. */
    const announce = async (
      supplierId: string,
      supplierName: string,
      importId: string,
      changed: number,
      warnings: string[],
      source: string,
    ) => {
      if (changed <= 0) return;
      const url = `${siteUrl()}/settings/suppliers/${supplierId}/imports/${importId}`;
      await sendEmail({
        to: ownerEmail(),
        subject: `${supplierName} changed ${changed} price${changed === 1 ? "" : "s"}`,
        html: emailLayout(
          "Supplier prices changed",
          `<p><strong>${supplierName}</strong> sent updated pricing on
            <strong>${changed}</strong> item${changed === 1 ? "" : "s"} we stock (${source.replace(/</g, "&lt;")}).</p>
           <p>Nothing has changed in the catalog yet — review the list and choose what to apply.
            Until you do, estimates keep using the costs you already have.</p>
           ${
             warnings.length
               ? `<p style="color:#8a6d3b">${warnings.map((w) => w.replace(/</g, "&lt;")).join("<br>")}</p>`
               : ""
           }`,
          { label: "Review the changes", url },
        ),
      });
    };

    for (const feed of await feedsDue(feedDb)) {
      // A mailbox we poll: every new 832 becomes its own draft.
      if (feed.transport === "sftp") {
        const run = await collectCatalogsOverSftp(feedDb, feed, feed.supplier_name);
        await recordFeedRun(feedDb, feed.id, run.error);
        if (run.error) continue;
        for (const imp of run.imports) {
          priceImports += 1;
          await announce(
            feed.supplier_id,
            feed.supplier_name,
            imp.importId,
            imp.changed,
            run.warnings,
            imp.fileName,
          );
        }
        continue;
      }

      const fetched = await fetchPricesOverRest(feedDb, feed, feed.supplier_name);
      await recordFeedRun(feedDb, feed.id, fetched.error);
      if (fetched.error || !fetched.rows.length) continue;

      const staged = await stagePriceImport(feedDb, {
        supplierId: feed.supplier_id,
        kind: "fcb2b_rest",
        sourceName: `${fetched.sourceName} — scheduled`,
        effectiveDate: fetched.effectiveDate,
        rows: fetched.rows,
        warnings: fetched.warnings,
      });
      if (!staged.importId) continue;
      priceImports += 1;
      await announce(
        feed.supplier_id,
        feed.supplier_name,
        staged.importId,
        staged.changed,
        staged.warnings,
        "scheduled price inquiry",
      );
    }
  } catch {
    /* supplier_feeds may not exist yet (migrations 0140/0145 not run) */
  }

  return NextResponse.json({
    started,
    staleScheduled,
    balanceChased,
    priceImports,
    ok: true,
    thankyou,
    reminders,
    reviews,
    nudges,
    resumed,
    sampleReminders,
  });
}

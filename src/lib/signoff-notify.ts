import { formatMoney } from "@/lib/format";
import { emailLayout, ownerEmail, sendEmail, siteUrl } from "@/lib/notify";
import { signoffNotice, type SignoffPaymentChoice, type SignoffPriceAlert } from "@/lib/signoff-sheet";
import { sendSms } from "@/lib/sms";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Email and text the salesperson on the customer (customers.assigned_to).
 * The store owner is emailed when that salesperson has no email. A failed
 * send must not undo the signature.
 */
export async function deliverJobSignoffNotice(input: {
  jobId: string;
  paymentChoice: SignoffPaymentChoice | null;
  balance: number;
  alert: SignoffPriceAlert;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("jobs")
      .select("customer_id, title")
      .eq("id", input.jobId)
      .maybeSingle();
    const customerId = (job?.customer_id as string | null) ?? null;
    let customerName = ((job?.title as string | null) ?? "").trim() || "Customer";
    let email: string | null = null;
    let phone: string | null = null;
    if (customerId) {
      const { data: customer } = await admin
        .from("customers")
        .select("full_name, assigned_to")
        .eq("id", customerId)
        .maybeSingle();
      const named = ((customer?.full_name as string | null) ?? "").trim();
      if (named) customerName = named;
      const salespersonId = (customer?.assigned_to as string | null) ?? null;
      if (salespersonId) {
        const { data: profile } = await admin
          .from("profiles")
          .select("email, phone")
          .eq("id", salespersonId)
          .maybeSingle();
        email = ((profile?.email as string | null) ?? "").trim() || null;
        phone = ((profile?.phone as string | null) ?? "").trim() || null;
      }
    }

    const jobUrl = `${siteUrl()}/jobs/${input.jobId}`;
    const notice = signoffNotice({
      customerName,
      paymentChoice: input.paymentChoice,
      balanceLabel: formatMoney(input.balance),
      alert: input.alert,
      money: formatMoney,
      jobUrl,
    });
    const html = emailLayout(notice.heading, notice.bodyHtml, {
      label: "Open the job",
      url: jobUrl,
    });
    if (email) {
      await sendEmail({ to: email, subject: notice.subject, html });
    } else {
      await sendEmail({ to: ownerEmail(), subject: notice.subject, html });
    }
    if (phone) await sendSms(phone, notice.sms);
  } catch {
    console.error("[signoff notify]");
  }
}

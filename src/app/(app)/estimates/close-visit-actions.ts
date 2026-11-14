"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { customerIsArchived } from "@/lib/customer-operational";
import { quoteText } from "@/lib/in-home-close";
import { sendSms } from "@/lib/sms";
import { siteUrl } from "@/lib/notify";
import { describeMessageSend } from "@/lib/message-send";
import { COMPANY_NAME } from "@/lib/nav";
import { advanceFromAutoAction } from "@/lib/workflow-engine";
import { onEstimateSentOps } from "@/lib/data/ops-automation";
import type { UserRole } from "@/lib/types";

const CLOSE_VISIT_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
];

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function back(id: string, query: string): never {
  redirect(`/estimates/${id}?${query}`);
}

/**
 * Text the customer their estimate link. A draft becomes Sent only after the
 * text is accepted, and the automatic thank-you email stays off because this
 * visit used a text, not the estimate email.
 */
export async function textEstimate(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) redirect("/estimates");

  try {
    await assertRole(CLOSE_VISIT_ROLES);
  } catch {
    back(id, "text=failed&text_detail=You%20don%E2%80%99t%20have%20permission%20to%20text%20this%20estimate.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: est } = await supabase
    .from("estimates")
    .select(
      "id, status, title, customer_id, customer:customers(full_name, phone, cancelled_at, assigned_to, workflow_owner_id)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!est) back(id, "text=failed&text_detail=Estimate%20was%20not%20found.");

  const cust = est.customer as unknown as {
    full_name: string | null;
    phone: string | null;
    cancelled_at: string | null;
    assigned_to: string | null;
    workflow_owner_id: string | null;
  } | null;
  if (customerIsArchived(cust?.cancelled_at)) {
    back(id, "text=failed&text_detail=This%20customer%20is%20archived.");
  }
  if (est.status === "declined") {
    back(id, "text=failed&text_detail=This%20estimate%20was%20declined.");
  }
  const phone = cust?.phone?.trim() || "";
  if (!phone) {
    back(id, "text=not_attempted&text_detail=No%20phone%20number%20on%20file.");
  }

  const { count, error: optionErr } = await supabase
    .from("estimate_options")
    .select("id", { count: "exact", head: true })
    .eq("estimate_id", id);
  if (optionErr || !count) {
    back(id, "text=failed&text_detail=Add%20a%20priced%20option%20before%20texting%20this%20estimate.");
  }

  const first = cust?.full_name?.split(" ")[0] ?? "there";
  const sent = await sendSms(
    phone,
    quoteText({
      firstName: first,
      company: COMPANY_NAME,
      url: `${siteUrl()}/portal/estimates/${id}`,
    }),
  );
  if (sent.status !== "success") {
    const detail = encodeURIComponent(describeMessageSend(sent));
    back(id, `text=${sent.status}&text_detail=${detail}`);
  }

  if (est.status === "draft") {
    const sentAt = new Date().toISOString();
    const { error } = await supabase
      .from("estimates")
      .update({
        status: "sent",
        sent_at: sentAt,
        thankyou_sent_at: sentAt,
      })
      .eq("id", id)
      .eq("status", "draft");
    if (!error && est.customer_id) {
      await advanceFromAutoAction(est.customer_id as string, "build_quote");
      await onEstimateSentOps({
        estimateId: id,
        customerId: est.customer_id as string,
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
  if (est.customer_id) revalidatePath(`/customers/${est.customer_id}`);
  back(id, "text=success&text_detail=sent");
}

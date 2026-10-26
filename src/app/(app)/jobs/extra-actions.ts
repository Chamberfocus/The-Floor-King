"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { extraChargeAllowed } from "@/lib/job-extra";
import { finalizeInvoiceSafe } from "@/lib/invoice-issue";
import { recomputeInvoiceStatus } from "@/lib/invoice-recompute";
import type { UserRole } from "@/lib/types";

const EXTRA_ROLES: UserRole[] = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "crew",
];

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function publicBillError(msg: string): string {
  if (/violat|schema|jwt|permission|syntax|duplicate key|sqlstate/i.test(msg)) {
    return "Couldn't add this to the bill. Refresh and try again.";
  }
  return msg.slice(0, 200);
}

async function nextInvoiceNumber(
  admin: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const { data } = await admin.from("invoices").select("number").limit(10000);
  let max = 1000;
  for (const row of data ?? []) {
    const match = /(\d+)\s*$/.exec((row.number as string | null) ?? "");
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `INV-${max + 1}`;
}

/** Customer signs an extra on the job. The amount is added to the open bill. */
export async function signJobExtra(
  formData: FormData,
): Promise<{ error: string | null }> {
  const jobId = str(formData.get("job_id"));
  if (!jobId) return { error: "Missing job." };
  const parsed = extraChargeAllowed({
    description: str(formData.get("description")),
    amount: parseFloat(str(formData.get("amount"))),
    signer: str(formData.get("signer_name")),
    signature: str(formData.get("signature")),
  });
  if (!parsed.ok) return { error: parsed.error };
  const key = str(formData.get("idempotency_key")).slice(0, 80);
  if (!key) return { error: "Refresh and sign again." };

  try {
    await assertRole(EXTRA_ROLES);
  } catch {
    return { error: "You can't add a charge on this job." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again." };

  const { data: job } = await supabase
    .from("jobs")
    .select("id, customer_id, estimate_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.customer_id) return { error: "That job is not on your list." };

  const { data: existing } = await supabase
    .from("job_extras")
    .select("id, invoice_id")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existing?.invoice_id) {
    const admin = createAdminClient();
    const { data: inv } = await admin
      .from("invoices")
      .select("status")
      .eq("id", existing.invoice_id)
      .maybeSingle();
    if ((inv?.status as string | null) === "draft") {
      const issued = await finalizeInvoiceSafe(admin, existing.invoice_id as string, user.id);
      if (!issued.ok) return { error: publicBillError(issued.error || "Couldn't open the bill.") };
      await recomputeInvoiceStatus(admin, existing.invoice_id as string, user.id);
    }
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/invoices/${existing.invoice_id}`);
    revalidatePath(`/customers/${job.customer_id}`);
    return { error: null };
  }

  let extraId = (existing?.id as string | undefined) ?? "";
  if (!extraId) {
    const { data: inserted, error: insErr } = await supabase
      .from("job_extras")
      .insert({
        job_id: jobId,
        description: parsed.description,
        amount: parsed.amount,
        signer_name: parsed.signer,
        signature: str(formData.get("signature")),
        idempotency_key: key,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (insErr?.code === "23505") return { error: null };
    if (insErr || !inserted) {
      return { error: "Couldn't save the signature. Apply the latest database update, then try again." };
    }
    extraId = inserted.id as string;
  }

  let charged = false;
  try {
    const admin = createAdminClient();
    const { data: invoices } = await admin
      .from("invoices")
      .select("id, status")
      .eq("job_id", jobId)
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1);
    let invoiceId = (invoices?.[0]?.id as string | undefined) ?? "";
    let status = (invoices?.[0]?.status as string | undefined) ?? "draft";

    if (!invoiceId) {
      let tax = 0;
      if (job.estimate_id) {
        const { data: est } = await admin
          .from("estimates")
          .select("tax_rate")
          .eq("id", job.estimate_id)
          .maybeSingle();
        tax = Number(est?.tax_rate) || 0;
      }
      const { data: created, error: invErr } = await admin
        .from("invoices")
        .insert({
          customer_id: job.customer_id,
          job_id: jobId,
          estimate_id: job.estimate_id,
          number: await nextInvoiceNumber(admin),
          issue_date: today(),
          tax_rate: tax,
          commercial_kind: "supplemental",
          notes: "Signed extra work",
          created_by: user.id,
          idempotency_key: `extra-invoice:${extraId}`,
        })
        .select("id, status")
        .single();
      if (invErr || !created) {
        throw new Error(invErr?.message || "Couldn't open the bill.");
      }
      invoiceId = created.id as string;
      status = (created.status as string) ?? "draft";
    }

    const { data: last } = await admin
      .from("invoice_items")
      .select("position")
      .eq("invoice_id", invoiceId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: lineErr } = await admin.from("invoice_items").insert({
      invoice_id: invoiceId,
      position: ((last?.position as number) ?? -1) + 1,
      description: `Extra: ${parsed.description}`,
      quantity: 1,
      unit: "",
      rate: parsed.amount,
    });
    if (lineErr) throw new Error(lineErr.message);
    charged = true;
    await admin.from("job_extras").update({ invoice_id: invoiceId }).eq("id", extraId);

    if (status === "draft") {
      const issued = await finalizeInvoiceSafe(admin, invoiceId, user.id);
      if (!issued.ok) throw new Error(issued.error || "Couldn't open the bill.");
    }
    await recomputeInvoiceStatus(admin, invoiceId, user.id);

    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/invoices/${invoiceId}`);
    revalidatePath(`/customers/${job.customer_id}`);
    revalidatePath("/portal");
    revalidatePath("/installer");
    return { error: null };
  } catch (err) {
    if (!charged) {
      try {
        await createAdminClient().from("job_extras").delete().eq("id", extraId);
      } catch {
        /* leave the signature row if the database cannot be reached */
      }
    }
    const msg = err instanceof Error ? err.message : "Couldn't add this to the bill.";
    return { error: publicBillError(msg) };
  }
}

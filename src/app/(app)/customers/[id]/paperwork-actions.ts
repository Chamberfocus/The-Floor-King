"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth";
import { refuseNewActiveWorkForCustomer } from "@/lib/active-work-guard";
import { extractBill, extractOrderDocument } from "@/lib/extract";
import { resolveApImportIdempotencyKey } from "@/lib/financial-idempotency";
import {
  draftFromCharges,
  finishPaperwork,
  moneyRound,
  type PaperworkKind,
  type PaperworkLine,
} from "@/lib/paperwork";
import { savePurchaseOrder } from "@/app/(app)/purchase-orders/actions";
import type { PoSourceType } from "@/lib/types";

export interface PaperworkApplyResult {
  error: string | null;
  href?: string;
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function kindOf(raw: string): PaperworkKind {
  if (raw === "order_confirmation" || raw === "vendor_invoice" || raw === "other") return raw;
  return "other";
}

function termKey(terms: string): string {
  const s = terms.toLowerCase();
  if (/receipt|cod|due now/.test(s)) return "due_on_receipt";
  const m = s.match(/net\s*(\d+)/);
  const n = m ? parseInt(m[1], 10) : null;
  if (n && [15, 30, 45, 60].includes(n)) return `net_${n}`;
  return "net_30";
}

function addDays(base: string, days: number): string {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function refresh(customerId: string) {
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  revalidatePath("/purchase-orders");
  revalidatePath("/bills");
  revalidatePath("/financials");
  revalidatePath("/pulse");
}

/** Read a photo of paperwork. A PDF is read in the browser from its text. */
export async function readPaperworkImage(
  formData: FormData,
): Promise<{ error: string | null; draft?: ReturnType<typeof draftFromCharges> }> {
  try {
    await assertRole(["admin", "office"]);
  } catch {
    return { error: "Only the office can read paperwork." };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > 20 * 1024 * 1024) return { error: "File is too large (max 20 MB)." };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "Paste the text from that photo. Photo reading needs the AI key." };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const mediaType = file.type || "image/jpeg";
  const bill = await extractBill({ base64: bytes.toString("base64"), mediaType });
  if (bill && (bill.items.length || bill.total != null)) {
    return {
      error: null,
      draft: draftFromCharges({
        kind: "vendor_invoice",
        vendor: bill.vendor,
        number: bill.bill_number,
        date: bill.bill_date,
        dueDate: bill.due_date,
        terms: bill.terms,
        lines: bill.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit: it.unit,
          unitCost: it.unit_cost,
          amount: it.amount,
        })),
        freight: bill.freight,
        tax: bill.tax,
        printedTotal: bill.total,
      }),
    };
  }
  const order = await extractOrderDocument({ base64: bytes.toString("base64"), mediaType });
  if (!order) return { error: "Couldn't read that photo. Paste the text instead." };
  return {
    error: null,
    draft: draftFromCharges({
      kind: "order_confirmation",
      vendor: order.vendor,
      number: order.order_number,
      date: order.order_date,
      eta: order.eta_date,
      lines: order.items.map((it) => ({
        description: it.description || [it.style, it.color, it.item_no].filter(Boolean).join(" "),
        quantity: it.quantity,
        unit: it.unit,
        unitCost: it.unit_cost,
        amount:
          it.quantity != null && it.unit_cost != null
            ? moneyRound(it.quantity * it.unit_cost)
            : null,
      })),
      printedTotal: order.total,
    }),
  };
}

export async function applyCustomerPaperwork(
  formData: FormData,
): Promise<PaperworkApplyResult> {
  try {
    await assertRole(["admin", "office"]);
  } catch {
    return { error: "Only the office can add paperwork." };
  }
  const customerId = str(formData.get("customer_id"));
  if (!customerId) return { error: "Missing customer." };
  const kind = kindOf(str(formData.get("kind")));
  const supplierId = str(formData.get("supplier_id")) || null;
  const vendor = str(formData.get("vendor"));
  const number = str(formData.get("number")).replace(/[%_]/g, "");
  const date = str(formData.get("date"));
  const dueDate = str(formData.get("due_date"));
  const eta = str(formData.get("eta"));
  const terms = str(formData.get("terms"));
  const jobIdInput = str(formData.get("job_id")) || null;
  const poIdInput = str(formData.get("po_id")) || null;
  const placeOrder = str(formData.get("place_order")) === "1";
  const printedRaw = str(formData.get("printed_total"));
  const printedTotal = printedRaw === "" ? null : Number(printedRaw);
  let lines: PaperworkLine[] = [];
  try {
    const parsed = JSON.parse(str(formData.get("lines")) || "[]") as PaperworkLine[];
    lines = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { error: "The lines could not be read. Read the paperwork again." };
  }

  const checked = finishPaperwork({
    kind,
    vendor,
    number,
    date,
    dueDate,
    eta,
    terms,
    shipTo: "",
    lines,
    printedTotal: printedTotal != null && Number.isFinite(printedTotal) ? printedTotal : null,
  });
  if (kind !== "other") {
    if (!checked.lines.length) return { error: "No lines to save." };
    if (checked.printedTotal != null && !checked.balanced) {
      return {
        error: "The lines do not add up to the document total. Fix them before saving so the money stays consistent.",
      };
    }
  }

  const supabase = await createClient();
  const blocked = await refuseNewActiveWorkForCustomer(supabase, customerId);
  if (blocked) return { error: blocked };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let jobId = jobIdInput;
  if (jobId) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id, customer_id, estimate_id")
      .eq("id", jobId)
      .maybeSingle();
    if (!job || job.customer_id !== customerId) {
      return { error: "That job is not on this customer." };
    }
  }

  if (kind === "vendor_invoice") {
    if (!supplierId) return { error: "Pick the vendor this invoice is from." };
    const idem = resolveApImportIdempotencyKey(str(formData.get("idempotency_key")));
    if (!idem) return { error: "Refresh the page and read the paperwork again." };
    if (number) {
      const { data: existing } = await supabase
        .from("bills")
        .select("id")
        .eq("supplier_id", supplierId)
        .eq("bill_number", number)
        .neq("ap_lifecycle", "void")
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        return { error: "That invoice number is already saved for this vendor.", href: `/bills/${existing.id}` };
      }
    }
    const poId = poIdInput;
    let estimateId: string | null = null;
    if (poId) {
      const { data: po } = await supabase
        .from("purchase_orders")
        .select("id, customer_id, job_id, estimate_id, supplier_id")
        .eq("id", poId)
        .maybeSingle();
      if (!po || po.customer_id !== customerId) {
        return { error: "That purchase order is not on this customer." };
      }
      estimateId = (po.estimate_id as string | null) ?? null;
      if (!jobId && po.job_id) jobId = po.job_id as string;
      if (!jobId && estimateId) {
        const { data: linked } = await supabase
          .from("jobs")
          .select("id")
          .eq("customer_id", customerId)
          .eq("estimate_id", estimateId)
          .limit(1)
          .maybeSingle();
        jobId = (linked?.id as string | null) ?? null;
      }
    }
    const billDate = checked.date || new Date().toISOString().slice(0, 10);
    const termsKey = termKey(checked.terms);
    const days = termsKey === "due_on_receipt" ? 0 : parseInt(termsKey.replace("net_", ""), 10) || 30;
    const due = checked.dueDate || addDays(billDate, days);
    const billLines = checked.lines.map((line, i) => ({
      position: i,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit || "ea",
      unit_cost: line.unitCost,
    }));
    const { data, error } = await supabase.rpc("create_vendor_bill_safe", {
      p_supplier_id: supplierId,
      p_lines: billLines,
      p_bill_date: billDate,
      p_due_date: due,
      p_bill_number: number || null,
      p_terms: termsKey,
      p_memo: number ? `From paperwork ${number}` : "From paperwork",
      p_job_id: jobId,
      p_po_id: poId,
      p_accounting_category: "material_purchase",
      p_source_type: "manual",
      p_idempotency_key: idem,
    });
    if (error) return { error: error.message };
    const res = data as { ok?: boolean; error?: string; bill_id?: string };
    if (res?.ok === false) return { error: res.error || "Couldn't save the invoice." };
    if (!res?.bill_id) return { error: "Couldn't save the invoice." };
    const activated = await supabase.rpc("activate_vendor_bill_safe", {
      p_bill_id: res.bill_id,
      p_idempotency_key: `ap-activate:${res.bill_id}`,
    });
    const act = activated.data as { ok?: boolean; error?: string } | null;
    if (activated.error || act?.ok === false) {
      return {
        error: act?.error || activated.error?.message || "The invoice is saved. Open the bill to activate it.",
        href: `/bills/${res.bill_id}`,
      };
    }
    await note(supabase, customerId, user?.id ?? null, `Vendor invoice ${number || ""} saved from paperwork.`.trim());
    await storeFile(supabase, formData, {
      customerId,
      userId: user?.id ?? null,
      poId,
      kind: "bill",
    });
    refresh(customerId);
    return { error: null, href: `/bills/${res.bill_id}` };
  }

  if (kind === "order_confirmation") {
    if (placeOrder && !supplierId) {
      return { error: "Pick the vendor before this order counts on the job." };
    }
    if (number) {
      const { data: existing } = await supabase
        .from("purchase_orders")
        .select("id")
        .eq("customer_id", customerId)
        .ilike("notes", `%Paperwork ${number}%`)
        .neq("status", "void")
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        return { error: "That order number is already on this customer.", href: `/purchase-orders/${existing.id}` };
      }
    }
    let estimateId: string | null = null;
    let sourceType: PoSourceType | null = null;
    let supplierName = vendor;
    if (jobId) {
      const { data: job } = await supabase
        .from("jobs")
        .select("estimate_id")
        .eq("id", jobId)
        .maybeSingle();
      estimateId = (job?.estimate_id as string | null) ?? null;
    }
    if (supplierId) {
      const { data: supplier } = await supabase
        .from("suppliers")
        .select("name, kind")
        .eq("id", supplierId)
        .maybeSingle();
      if (!supplier) return { error: "That vendor is not on the list." };
      supplierName = (supplier.name as string) || vendor;
      const kindName = supplier.kind as string;
      sourceType = kindName === "manufacturer" || kindName === "distributor" ? kindName : null;
    }
    const { data: po, error: insertError } = await supabase
      .from("purchase_orders")
      .insert({
        customer_id: customerId,
        job_id: jobId,
        estimate_id: estimateId,
        supplier: supplierName || null,
        supplier_id: supplierId,
        source_type: sourceType,
        status: "draft",
        notes: number ? `Paperwork ${number}` : "Paperwork",
        eta_date: eta || null,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (insertError || !po) return { error: insertError?.message || "Couldn't start the purchase order." };
    const saved = await savePurchaseOrder(po.id as string, {
      supplier: supplierName,
      supplier_id: supplierId,
      source_type: sourceType,
      status: placeOrder ? "ordered" : "draft",
      notes: number ? `Paperwork ${number}` : "Paperwork",
      eta_date: eta || null,
      backordered: false,
      items: checked.lines.map((line) => ({
        product_id: null,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_cost: line.unitCost,
        for_job_id: jobId,
        for_customer_id: customerId,
      })),
    });
    if (saved.error) return { error: saved.error, href: `/purchase-orders/${po.id}` };
    await note(
      supabase,
      customerId,
      user?.id ?? null,
      placeOrder
        ? `Order confirmation ${number || ""} is on a purchase order and counted in the job cost.`.trim()
        : `Order confirmation ${number || ""} is saved as a draft purchase order.`.trim(),
    );
    await storeFile(supabase, formData, {
      customerId,
      userId: user?.id ?? null,
      poId: po.id as string,
      kind: "order_confirmation",
    });
    refresh(customerId);
    return { error: null, href: `/purchase-orders/${po.id}` };
  }

  await note(
    supabase,
    customerId,
    user?.id ?? null,
    `Paperwork on file${vendor ? ` from ${vendor}` : ""}${number ? ` ${number}` : ""}.`.trim(),
  );
  await storeFile(supabase, formData, {
    customerId,
    userId: user?.id ?? null,
    poId: null,
    kind: "other",
  });
  refresh(customerId);
  return { error: null, href: `/customers/${customerId}` };
}

async function note(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string,
  userId: string | null,
  body: string,
) {
  await supabase.from("activities").insert({
    customer_id: customerId,
    user_id: userId,
    type: "note",
    body,
  });
}

async function storeFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
  input: { customerId: string; userId: string | null; poId: string | null; kind: string },
) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const path = `${input.customerId}/${crypto.randomUUID()}-${file.name}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const { error } = await supabase.storage.from("documents").upload(path, bytes, { contentType: mime });
  if (error) return;
  await supabase.from("documents").insert({
    customer_id: input.customerId,
    po_id: input.poId,
    uploaded_by: input.userId,
    name: file.name,
    path,
    mime,
    kind: input.kind,
  });
}

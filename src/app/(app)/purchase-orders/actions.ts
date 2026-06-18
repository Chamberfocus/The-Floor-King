"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SavePoInput } from "@/lib/po-calc";
import { lineQty } from "@/lib/estimate-calc";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { extractOrderDocument, type ExtractedDoc } from "@/lib/extract";
import type { EstimateLineItem, PoStatus } from "@/lib/types";

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function toNumOrNull(v: string | number | null): number | null {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Generate a PO from an estimate's accepted (or first) option material lines. */
export async function createPOFromEstimate(formData: FormData): Promise<void> {
  const estimateId = str(formData.get("estimate_id"));
  if (!estimateId) return;

  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select("id, customer_id, accepted_option_id")
    .eq("id", estimateId)
    .maybeSingle();
  if (!est) return;

  let optionId = (est.accepted_option_id as string | null) ?? null;
  if (!optionId) {
    const { data: opt } = await supabase
      .from("estimate_options")
      .select("id")
      .eq("estimate_id", estimateId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    optionId = (opt?.id as string) ?? null;
  }

  let lines: EstimateLineItem[] = [];
  if (optionId) {
    const { data } = await supabase
      .from("estimate_line_items")
      .select("*")
      .eq("option_id", optionId)
      .order("position", { ascending: true });
    lines = (data ?? []) as EstimateLineItem[];
  }

  // Product material rates for installed lines linked to a product.
  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter(Boolean) as string[]),
  ];
  const productCost = new Map<string, number>();
  const productName = new Map<string, string>();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, material_rate")
      .in("id", productIds);
    for (const p of prods ?? []) {
      productCost.set(p.id as string, Number(p.material_rate) || 0);
      productName.set(p.id as string, p.name as string);
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: po, error } = await supabase
    .from("purchase_orders")
    .insert({
      customer_id: est.customer_id,
      estimate_id: estimateId,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !po) return;

  const items = lines
    // Include every quantity-bearing line — area-measured AND perimeter/each
    // companions (tackstrip, transitions, trim) which have qty but no sqft.
    .filter((l) => l.line_type !== "flat" && lineQty(l) > 0)
    .map((l, i) => {
      // PO cost = our cost (saved material_cost), else the product's cost,
      // never the customer sell rate.
      const unitCost =
        (l.material_cost ?? 0) > 0
          ? (l.material_cost ?? 0)
          : l.product_id
            ? (productCost.get(l.product_id) ?? 0)
            : 0;
      const desc =
        l.description ||
        (l.product_id ? productName.get(l.product_id) : null) ||
        l.room ||
        "Material";
      return {
        po_id: po.id,
        position: i,
        product_id: l.product_id,
        description: desc,
        quantity: Math.round(lineQty(l) * 100) / 100,
        unit: l.unit || (l.measure_unit === "sqyd" ? "sqyd" : "sqft"),
        unit_cost: unitCost,
      };
    });
  if (items.length) await supabase.from("po_items").insert(items);

  revalidatePath("/purchase-orders");
  redirect(`/purchase-orders/${po.id}`);
}

export async function savePurchaseOrder(
  poId: string,
  input: SavePoInput,
): Promise<{ error: string | null }> {
  const supabase = await createClient();

  const { data: before } = await supabase
    .from("purchase_orders")
    .select("status, customer_id, backordered")
    .eq("id", poId)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      supplier: input.supplier || null,
      status: input.status,
      notes: input.notes || null,
      eta_date: input.eta_date || null,
      backordered: input.backordered,
    })
    .eq("id", poId);
  if (updateError) return { error: updateError.message };

  // Newly backordered → alert the whole team + warehouse + the customer.
  if (input.backordered && !before?.backordered) {
    const customerId = (before?.customer_id as string | null) ?? null;
    const etaText = input.eta_date
      ? new Date(input.eta_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "TBD";

    const recipients = new Set<string>([ownerEmail()]);
    const { data: wh } = await supabase
      .from("profiles")
      .select("email")
      .eq("role", "warehouse");
    for (const w of wh ?? []) if (w.email) recipients.add(w.email as string);

    let cust: { full_name: string | null; email: string | null } | null = null;
    if (customerId) {
      const { data: c } = await supabase
        .from("customers")
        .select("full_name, email, assigned_to, workflow_owner_id")
        .eq("id", customerId)
        .maybeSingle();
      cust = (c as { full_name: string | null; email: string | null }) ?? null;
      const repId =
        (c?.assigned_to as string | null) ??
        (c?.workflow_owner_id as string | null) ??
        null;
      if (repId) {
        const { data: rep } = await supabase
          .from("profiles")
          .select("email")
          .eq("id", repId)
          .maybeSingle();
        if (rep?.email) recipients.add(rep.email as string);
      }
    }

    for (const to of recipients) {
      await sendEmail({
        to,
        subject: `⚠️ Backorder — ${input.supplier || "materials"}`,
        html: emailLayout(
          "Material backordered",
          `<p>A purchase order${input.supplier ? ` from ${input.supplier}` : ""} is on <strong>backorder</strong>. Expected arrival: <strong>${etaText}</strong>.</p>${cust?.full_name ? `<p>Customer: ${cust.full_name}</p>` : ""}`,
          { label: "Open PO", url: `${siteUrl()}/purchase-orders/${poId}` },
        ),
      });
    }

    if (customerId && cust?.email) {
      await sendEmail({
        to: cust.email,
        subject: "Update on your materials",
        html: emailLayout(
          "A quick update on your materials",
          `<p>Hi ${cust.full_name?.split(" ")[0] ?? "there"},</p>
           <p>One of the items for your project is on backorder from the supplier. We now expect it by <strong>${etaText}</strong> and will keep you posted.</p>`,
          { label: "View your project", url: `${siteUrl()}/portal` },
        ),
      });
    }
    if (customerId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await supabase.from("messages").insert({
        customer_id: customerId,
        channel: "client",
        author_id: user?.id ?? null,
        body: `⏳ Heads up: an item is on backorder — new ETA ${etaText}. We'll keep you updated.`,
      });
    }
  }

  // When a PO is newly marked "ordered", let the customer know.
  if (
    before?.status !== "ordered" &&
    input.status === "ordered" &&
    before?.customer_id
  ) {
    const customerId = before.customer_id as string;
    const { data: c } = await supabase
      .from("customers")
      .select("full_name, email")
      .eq("id", customerId)
      .maybeSingle();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (c?.email) {
      await sendEmail({
        to: c.email as string,
        subject: "Your materials are on order",
        html: emailLayout(
          "Materials ordered ✅",
          `<p>Hi ${(c.full_name as string)?.split(" ")[0] ?? "there"},</p>
           <p>Good news — the materials for your project have been ordered. We'll let you know as soon as they arrive and we can schedule your install.</p>`,
          { label: "View your project", url: `${siteUrl()}/portal` },
        ),
      });
    }
    await supabase.from("messages").insert({
      customer_id: customerId,
      channel: "client",
      author_id: user?.id ?? null,
      body: "📦 Your materials have been ordered. We'll update you when they arrive.",
    });
  }

  // Crash-safe: insert new items first, then delete the old ones, so a failed
  // insert can't leave the PO with no line items.
  const { data: oldItems } = await supabase
    .from("po_items")
    .select("id")
    .eq("po_id", poId);
  const oldIds = (oldItems ?? []).map((r) => r.id as string);

  if (input.items.length) {
    const rows = input.items.map((it, i) => ({
      po_id: poId,
      position: i,
      product_id: it.product_id || null,
      description: it.description || "",
      quantity: toNumOrNull(it.quantity),
      unit: it.unit || "sqft",
      unit_cost: toNumOrNull(it.unit_cost),
      manufacturer: it.manufacturer || null,
      style: it.style || null,
      color: it.color || null,
      item_no: it.item_no || null,
    }));
    const { error: insertError } = await supabase.from("po_items").insert(rows);
    if (insertError) return { error: insertError.message };
  }
  if (oldIds.length) {
    await supabase.from("po_items").delete().in("id", oldIds);
  }

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  return { error: null };
}

export async function setPurchaseOrderStatus(
  formData: FormData,
): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as PoStatus;
  if (!id || !status) return;
  const supabase = await createClient();
  await supabase.from("purchase_orders").update({ status }).eq("id", id);
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
}

export async function deletePurchaseOrder(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("purchase_orders").delete().eq("id", id);
  revalidatePath("/purchase-orders");
  redirect("/purchase-orders");
}

export interface ExtractResult {
  error: string | null;
  data?: ExtractedDoc;
}

/**
 * Smart uploader: store an uploaded order confirmation, run AI extraction,
 * and return structured line items to drop into the PO builder.
 */
export async function extractPoDocument(
  formData: FormData,
): Promise<ExtractResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > 20 * 1024 * 1024) {
    return { error: "File is too large (max 20 MB)." };
  }
  const poId = str(formData.get("po_id")) || null;
  const customerId = str(formData.get("customer_id")) || null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const path = `${poId ?? "misc"}/${crypto.randomUUID()}-${file.name}`;

  // Store the original document (best-effort — extraction still runs if this fails).
  await supabase.storage
    .from("documents")
    .upload(path, bytes, { contentType: mime, upsert: false });

  const extracted = await extractOrderDocument({
    base64: bytes.toString("base64"),
    mediaType: mime,
  });

  await supabase.from("documents").insert({
    customer_id: customerId,
    po_id: poId,
    uploaded_by: auth.user?.id ?? null,
    name: file.name,
    path,
    mime,
    kind: "order_confirmation",
    extracted: extracted ?? null,
  });

  if (!extracted) {
    return {
      error:
        "Couldn't read that document automatically. The file is saved — add the items manually, or set ANTHROPIC_API_KEY to enable AI reading.",
    };
  }
  return { error: null, data: extracted };
}

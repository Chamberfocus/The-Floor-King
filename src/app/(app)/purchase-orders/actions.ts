"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SavePoInput } from "@/lib/po-calc";
import { lineQty } from "@/lib/estimate-calc";
import { sendEmail, emailLayout, siteUrl, ownerEmail } from "@/lib/notify";
import { extractOrderDocument, type ExtractedDoc } from "@/lib/extract";
import { reconcilePoStock, reverseReceivedPOs } from "@/lib/po-stock";
import { buildSupplierLookup, resolveLineSupplier } from "@/lib/data/suppliers";
import type { EstimateLineItem, PoSourceType, PoStatus } from "@/lib/types";

type PoDb = Awaited<ReturnType<typeof createClient>>;

/**
 * Tell the customer (portal message + email) their materials were ordered.
 * Shared by the PO builder save AND the quick status button so both do the same
 * customer-facing follow-through. Returns the customer id (for revalidation).
 */
async function notifyPoOrdered(supabase: PoDb, poId: string): Promise<string | null> {
  const { data: po } = await supabase
    .from("purchase_orders")
    .select("customer_id")
    .eq("id", poId)
    .maybeSingle();
  const customerId = (po?.customer_id as string | null) ?? null;
  if (!customerId) return null;
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
  return customerId;
}

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

  // Product material rates + supplier for installed lines linked to a product.
  const productIds = [
    ...new Set(lines.map((l) => l.product_id).filter(Boolean) as string[]),
  ];
  const productCost = new Map<string, number>();
  const productName = new Map<string, string>();
  const productSupplier = new Map<string, string | null>();
  const productSupplierId = new Map<string, string | null>();
  if (productIds.length) {
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, material_rate, supplier, supplier_id")
      .in("id", productIds);
    for (const p of prods ?? []) {
      productCost.set(p.id as string, Number(p.material_rate) || 0);
      productName.set(p.id as string, p.name as string);
      productSupplier.set(p.id as string, (p.supplier as string) || null);
      productSupplierId.set(p.id as string, (p.supplier_id as string) || null);
    }
  }

  const lookup = await buildSupplierLookup(supabase);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Only quantity-bearing MATERIAL lines. Labor (install, tear-out, prep) is
  // never ordered as material — and anything pulled FROM STOCK is excluded
  // (we already have it; the estimate/work order still show it).
  const orderable = lines.filter(
    (l) =>
      l.line_type !== "flat" &&
      l.category !== "labor" &&
      !l.from_stock &&
      lineQty(l) > 0,
  );
  if (!orderable.length) {
    // Still create an empty PO so the user lands somewhere sensible.
    const { data: po } = await supabase
      .from("purchase_orders")
      .insert({
        customer_id: est.customer_id,
        estimate_id: estimateId,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    revalidatePath("/purchase-orders");
    if (po) redirect(`/purchase-orders/${po.id}`);
    return;
  }

  // Group lines by the vendor we order them from → one PO per supplier.
  const groups = new Map<
    string,
    {
      name: string;
      supplierId: string | null;
      sourceType: PoSourceType;
      lines: EstimateLineItem[];
    }
  >();
  for (const l of orderable) {
    const resolved = resolveLineSupplier(lookup, {
      productSupplierId: l.product_id
        ? productSupplierId.get(l.product_id)
        : null,
      supplierName:
        (l.product_id ? productSupplier.get(l.product_id) : null) ||
        l.manufacturer ||
        null,
    });
    const g = groups.get(resolved.key) ?? {
      name: resolved.name,
      supplierId: resolved.ref?.id ?? null,
      sourceType: (resolved.ref?.kind ?? "distributor") as PoSourceType,
      lines: [],
    };
    g.lines.push(l);
    groups.set(resolved.key, g);
  }

  let firstPoId: string | null = null;
  for (const [, group] of groups) {
    const glines = group.lines;
    const { data: po, error } = await supabase
      .from("purchase_orders")
      .insert({
        customer_id: est.customer_id,
        estimate_id: estimateId,
        supplier: group.name,
        supplier_id: group.supplierId,
        source_type: group.sourceType,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !po) continue;
    if (!firstPoId) firstPoId = po.id as string;

    const costOf = (l: EstimateLineItem) =>
      (l.material_cost ?? 0) > 0
        ? (l.material_cost ?? 0)
        : l.product_id
          ? (productCost.get(l.product_id) ?? 0)
          : 0;
    const nameOf = (l: EstimateLineItem) =>
      l.description || (l.product_id ? productName.get(l.product_id) : null) || l.room || "Material";

    // Lines flagged "order as roll" consolidate into one roll per product/width;
    // everyone else is ordered as its individual cut.
    const cutLines = glines.filter((l) => !l.order_as_roll);
    const rollLines = glines.filter((l) => l.order_as_roll);

    const items = cutLines.map((l, i) => {
      // Carpet & any measured line: show the cut size to order, not just yards.
      const dims =
        l.length_in && l.width_in
          ? ` — ${ftIn(Number(l.width_in))} × ${ftIn(Number(l.length_in))}`
          : "";
      return {
        po_id: po.id,
        position: i,
        product_id: l.product_id,
        description: `${nameOf(l)}${dims}`,
        quantity: Math.round(lineQty(l) * 100) / 100,
        unit: l.unit || (l.measure_unit === "sqyd" ? "sqyd" : "sqft"),
        unit_cost: costOf(l),
        manufacturer: l.manufacturer ?? null,
        style: l.style ?? null,
        color: l.color ?? null,
        item_no: l.item_no ?? null,
      };
    });

    // Group roll lines by product + roll width → one roll line (linear ft + yardage).
    const rollGroups = new Map<
      string,
      { product_id: string | null; width: number; sqyd: number; sample: EstimateLineItem }
    >();
    for (const l of rollLines) {
      const width = Number(l.roll_width_ft) > 0 ? Number(l.roll_width_ft) : 12;
      const key = `${l.product_id ?? nameOf(l)}|${width}`;
      const g = rollGroups.get(key) ?? { product_id: l.product_id, width, sqyd: 0, sample: l };
      // Roll math is in square yards regardless of the line's billing unit.
      const sqyd =
        l.measure_unit === "sqyd" ? lineQty(l) : lineQty(l) / 9;
      g.sqyd += sqyd;
      rollGroups.set(key, g);
    }
    let pos = items.length;
    for (const g of rollGroups.values()) {
      const sqyd = Math.round(g.sqyd * 100) / 100;
      const linft = Math.round(((sqyd * 9) / g.width) * 10) / 10; // total sqft ÷ roll width
      items.push({
        po_id: po.id,
        position: pos++,
        product_id: g.product_id,
        description: `Full roll — ${nameOf(g.sample)} — ${linft} lin ft (${sqyd} sq yd) @ ${g.width} ft wide`,
        quantity: sqyd,
        unit: "sqyd",
        unit_cost: costOf(g.sample),
        manufacturer: g.sample.manufacturer ?? null,
        style: g.sample.style ?? null,
        color: g.sample.color ?? null,
        item_no: g.sample.item_no ?? null,
      });
    }
    if (items.length) await supabase.from("po_items").insert(items);
  }

  revalidatePath("/purchase-orders");
  if (firstPoId) redirect(`/purchase-orders/${firstPoId}`);
  redirect("/purchase-orders");
}

/** Inches → feet'inches" (e.g. 150 → 12'6"). */
function ftIn(inches: number): string {
  if (!Number.isFinite(inches) || inches <= 0) return "";
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches % 12);
  return inch > 0 ? `${ft}'${inch}"` : `${ft}'`;
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
  const prevStatus = (before?.status as PoStatus | undefined) ?? undefined;

  const { error: updateError } = await supabase
    .from("purchase_orders")
    .update({
      supplier: input.supplier || null,
      supplier_id: input.supplier_id || null,
      source_type: input.source_type || null,
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
  if (before?.status !== "ordered" && input.status === "ordered" && before?.customer_id) {
    await notifyPoOrdered(supabase, poId);
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
      for_job_id: it.for_job_id || null,
      for_customer_id: it.for_customer_id || null,
      note: it.note || null,
    }));
    let { error: insertError } = await supabase.from("po_items").insert(rows);
    if (insertError) {
      // Fallback for before the attribution migration (0097) is run — save the
      // line items without the new columns so PO saving never breaks.
      const legacy = rows.map(
        ({ for_job_id: _j, for_customer_id: _c, note: _n, ...r }) => r,
      );
      ({ error: insertError } = await supabase.from("po_items").insert(legacy));
    }
    if (insertError) return { error: insertError.message };
  }
  if (oldIds.length) {
    await supabase.from("po_items").delete().in("id", oldIds);
  }

  // Reconcile inventory AFTER items are saved, so a received PO restocks the
  // current quantities. Same single reconciler the status buttons use — editing
  // status in the builder can no longer skip it.
  await reconcilePoStock(supabase, poId, prevStatus, input.status);

  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/inventory");
  revalidatePath("/warehouse");
  if (before?.customer_id) revalidatePath(`/customers/${before.customer_id}`);
  return { error: null };
}

export async function setPurchaseOrderStatus(
  formData: FormData,
): Promise<void> {
  const id = str(formData.get("id"));
  const status = str(formData.get("status")) as PoStatus;
  if (!id || !status) return;
  const supabase = await createClient();

  // Look at the prior status so we only restock on the transition into/out of
  // "received" — re-saving "received" must not double-count.
  const { data: cur } = await supabase
    .from("purchase_orders")
    .select("status, customer_id")
    .eq("id", id)
    .maybeSingle();
  const prev = cur?.status as PoStatus | undefined;

  await supabase.from("purchase_orders").update({ status }).eq("id", id);
  await reconcilePoStock(supabase, id, prev, status);

  // Same customer-facing follow-through the PO builder does when it hits
  // "ordered" — the status button was silently skipping it.
  if (prev !== "ordered" && status === "ordered") {
    await notifyPoOrdered(supabase, id);
  }

  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/inventory");
  revalidatePath("/warehouse");
  if (cur?.customer_id) revalidatePath(`/customers/${cur.customer_id}`);
}

export async function deletePurchaseOrder(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  if (!id) return;
  const supabase = await createClient();
  // If this PO was received, undo the stock it added before deleting — no
  // phantom on-hand left behind.
  await reverseReceivedPOs(supabase, [id]);
  await supabase.from("purchase_orders").delete().eq("id", id);
  revalidatePath("/purchase-orders");
  revalidatePath("/inventory");
  revalidatePath("/warehouse");
  redirect("/purchase-orders");
}

/** Start a blank PO straight from a customer's file (PO follows the customer). */
export async function createBlankPO(formData: FormData): Promise<void> {
  const customerId = str(formData.get("customer_id")) || null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: po } = await supabase
    .from("purchase_orders")
    .insert({
      customer_id: customerId,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  revalidatePath("/purchase-orders");
  if (customerId) revalidatePath(`/customers/${customerId}`);
  if (po) redirect(`/purchase-orders/${po.id}`);
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

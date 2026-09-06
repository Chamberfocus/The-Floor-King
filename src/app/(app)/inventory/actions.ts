"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRole } from "@/lib/auth";
import { syncRolledOnHand, reorderAlertsFor, type ReorderAlert } from "@/lib/data/stock-rolls";
import type { Product } from "@/lib/types";

const STOCK_ROLES: ("admin" | "office" | "warehouse")[] = ["admin", "office", "warehouse"];
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Search catalog products NOT yet tracked — for the "add to inventory" picker. */
export async function searchUntrackedProducts(
  query: string,
): Promise<Product[]> {
  const supabase = await createClient();
  let q = supabase
    .from("products")
    .select("*")
    .eq("track_stock", false)
    .order("name", { ascending: true })
    .limit(30);
  const term = query.trim();
  if (term) {
    const like = `%${term}%`;
    q = q.or(
      [`name.ilike.${like}`, `sku.ilike.${like}`, `manufacturer.ilike.${like}`].join(
        ",",
      ),
    );
  }
  const { data } = await q;
  return (data ?? []) as Product[];
}

function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function numv(v: FormDataEntryValue | null): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
}

function refresh(productId?: string) {
  revalidatePath("/inventory");
  if (productId) revalidatePath(`/inventory/${productId}`);
  revalidatePath("/catalog");
}

export async function receiveStock(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  const qty = Math.abs(numv(formData.get("qty")));
  if (!id || !qty) return;
  const { db, actorId } = await stockCtx();
  const { data: prod } = await db
    .from("products")
    .select("stock_kind")
    .eq("id", id)
    .maybeSingle();
  if (prod?.stock_kind === "rolled") {
    // Discrete receive UI must not value rolled stock without a physical roll.
    return;
  }
  await db.rpc("receive_inventory_safe", {
    p_product_id: id,
    p_qty: qty,
    p_note: str(formData.get("note")) || null,
    p_created_by: actorId,
  });
  refreshStock(id);
}

export async function pullStock(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  const qty = Math.abs(numv(formData.get("qty")));
  const jobId = str(formData.get("job_id"));
  if (!id || !qty || !jobId) return;
  // Fail-closed: consume_inventory_safe rejects over-pull (no silent negatives).
  const { db, actorId } = await stockCtx();
  await db.rpc("consume_inventory_safe", {
    p_product_id: id,
    p_qty: qty,
    p_job_id: jobId,
    p_note: str(formData.get("note")) || "Pulled for job",
    p_created_by: actorId,
    p_release_reserved: true,
  });
  refreshStock(id);
}

/** Set on-hand to an exact counted value (records the difference as an adjust). */
export async function adjustStock(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  const counted = numv(formData.get("counted"));
  if (!id) return;
  const { db, actorId } = await stockCtx();
  const { data: prod } = await db
    .from("products")
    .select("stock_kind")
    .eq("id", id)
    .maybeSingle();
  if (prod?.stock_kind === "rolled") {
    // Use countRoll / adjust_roll_inventory_safe per physical roll.
    return;
  }
  await db.rpc("adjust_inventory_safe", {
    p_product_id: id,
    p_counted_on_hand: counted,
    p_reason: str(formData.get("note")) || `Counted ${counted}`,
    p_note: str(formData.get("note")) || `Counted ${counted}`,
    p_created_by: actorId,
  });
  refreshStock(id);
}

/** Turn tracking on/off and set reorder point, bin, and "in stock since". */
export async function setStockSettings(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  if (!id) return;
  const update: Record<string, unknown> = {
    track_stock: str(formData.get("track_stock")) === "on",
    reorder_point: numv(formData.get("reorder_point")),
    bin_location: str(formData.get("bin_location")) || null,
  };
  const kind = str(formData.get("stock_kind"));
  if (kind === "discrete" || kind === "rolled") update.stock_kind = kind;
  // Optional: backdate "in stock since" so known-old stock ages correctly.
  const since = str(formData.get("stocked_since"));
  if (since) update.last_movement_at = new Date(since).toISOString();
  const supabase = await createClient();
  await supabase.from("products").update(update).eq("id", id);
  refresh(id);
}

/** Mark/unmark an item as clearance with a custom deal price. */
export async function setClearance(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  if (!id) return;
  const on = str(formData.get("clearance")) === "on";
  const price = numv(formData.get("clearance_price"));
  const supabase = await createClient();
  await supabase
    .from("products")
    .update({
      clearance: on,
      clearance_price: on && price > 0 ? price : null,
    })
    .eq("id", id);
  refresh(id);
}

// --- Rolled goods: individual rolls + remnants (measured, not whole units) ---

/** Warehouse/staff run these; use the service role so counts + rolls never fail
 *  on the warehouse role's narrow RLS. Returns the elevated client + actor id. */
async function stockCtx() {
  const profile = await assertRole(STOCK_ROLES);
  return { db: createAdminClient(), actorId: profile.id };
}

function refreshStock(productId?: string) {
  refresh(productId);
  revalidatePath("/warehouse");
}

/** Receive a physical roll (from a stock PO or opening count) as measured stock. */
export async function receiveRoll(formData: FormData): Promise<void> {
  const productId = str(formData.get("product_id"));
  const qty = Math.abs(numv(formData.get("qty")));
  if (!productId || qty <= 0) return;
  const { db, actorId } = await stockCtx();
  const unit = str(formData.get("unit")) || "sqyd";
  const width = numv(formData.get("width_ft"));
  const poId = str(formData.get("po_id")) || null;
  const location = str(formData.get("location")) || null;
  // F6-P4: RPC atomically creates stock_rolls + valued receive (no split-brain).
  await db.rpc("receive_inventory_safe", {
    p_product_id: productId,
    p_qty: qty,
    p_note: `Received roll · ${qty} ${unit}${location ? ` @ ${location}` : ""}`,
    p_po_id: poId,
    p_created_by: actorId,
    p_create_roll: true,
    p_roll_kind: "roll",
    p_roll_unit: unit,
    p_roll_width_ft: width > 0 ? width : null,
    p_roll_location: location,
  });
  refreshStock(productId);
}

/** Cut/pull from a roll for a job; optionally record an offcut as a new remnant. */
export async function pullRoll(formData: FormData): Promise<void> {
  const rollId = str(formData.get("roll_id"));
  const cut = Math.abs(numv(formData.get("cut")));
  if (!rollId || cut <= 0) return;
  const { db, actorId } = await stockCtx();
  const { data: roll } = await db
    .from("stock_rolls")
    .select("id, product_id, unit, remaining_qty, location")
    .eq("id", rollId)
    .maybeSingle();
  if (!roll) return;
  const productId = roll.product_id as string;
  const remaining = Number(roll.remaining_qty) || 0;
  const take = Math.min(cut, remaining); // guard: never below zero
  const left = r2(remaining - take);
  const jobId = str(formData.get("job_id"));
  const cutNote = `Cut ${take} ${roll.unit} → ${left} left${take < cut ? ` (requested ${cut}, capped to available)` : ""}`;
  // F6-P4: consume_inventory_safe decrements the roll under lock when roll_id set.
  if (jobId) {
    await db.rpc("consume_inventory_safe", {
      p_product_id: productId,
      p_qty: take,
      p_job_id: jobId,
      p_note: cutNote,
      p_created_by: actorId,
      p_release_reserved: true,
      p_roll_id: rollId,
    });
  } else {
    // Non-job cut: roll-specific adjust (aggregate product adjust blocked for rolled).
    await db.rpc("adjust_roll_inventory_safe", {
      p_roll_id: rollId,
      p_counted_remaining: left,
      p_reason: cutNote,
      p_created_by: actorId,
    });
  }
  // Optional offcut → remnant via atomic receive+create_roll.
  const offcut = Math.abs(numv(formData.get("offcut")));
  if (offcut > 0) {
    await db.rpc("receive_inventory_safe", {
      p_product_id: productId,
      p_qty: offcut,
      p_note: `Remnant created from cut · ${offcut} ${roll.unit} (needs shelving)`,
      p_job_id: str(formData.get("job_id")) || null,
      p_created_by: actorId,
      p_create_roll: true,
      p_roll_kind: "remnant",
      p_roll_unit: roll.unit as string,
      p_source_roll_id: rollId,
    });
  }
  refreshStock(productId);
}

/** Give a roll/remnant a physical location (and clear the "needs shelving" flag). */
export async function shelveRoll(formData: FormData): Promise<void> {
  const rollId = str(formData.get("roll_id"));
  if (!rollId) return;
  const { db } = await stockCtx();
  const { data: roll } = await db.from("stock_rolls").select("product_id").eq("id", rollId).maybeSingle();
  await db
    .from("stock_rolls")
    .update({ location: str(formData.get("location")) || null, needs_shelving: false })
    .eq("id", rollId);
  refreshStock((roll?.product_id as string) ?? undefined);
}

/** Mark a remnant reusable / not-worth-keeping, or scrap it (logged out with reason). */
export async function setRemnantUsable(formData: FormData): Promise<void> {
  const rollId = str(formData.get("roll_id"));
  const call = str(formData.get("call")); // usable | not | scrap
  if (!rollId || !call) return;
  const { db, actorId } = await stockCtx();
  const { data: roll } = await db
    .from("stock_rolls")
    .select("product_id, unit, remaining_qty")
    .eq("id", rollId)
    .maybeSingle();
  if (!roll) return;
  const productId = roll.product_id as string;
  if (call === "scrap") {
    const reason = str(formData.get("reason")) || "Scrapped";
    // Zero remaining via roll workflow, then mark scrapped.
    await db.rpc("adjust_roll_inventory_safe", {
      p_roll_id: rollId,
      p_counted_remaining: 0,
      p_reason: `Remnant scrapped · ${reason}`,
      p_created_by: actorId,
    });
    await db
      .from("stock_rolls")
      .update({ status: "scrapped", usable: false, needs_shelving: false, scrap_reason: reason })
      .eq("id", rollId);
  } else {
    await db
      .from("stock_rolls")
      .update({ usable: call === "usable", needs_shelving: false })
      .eq("id", rollId);
  }
  refreshStock(productId);
}

/** Physical count on ONE roll/remnant → set remaining to the counted value, log the delta. */
export async function countRoll(formData: FormData): Promise<void> {
  const rollId = str(formData.get("roll_id"));
  const counted = numv(formData.get("counted"));
  if (!rollId) return;
  const { db, actorId } = await stockCtx();
  const { data: roll } = await db
    .from("stock_rolls")
    .select("product_id, unit, remaining_qty")
    .eq("id", rollId)
    .maybeSingle();
  if (!roll) return;
  const productId = roll.product_id as string;
  const delta = r2(counted - (Number(roll.remaining_qty) || 0));
  if (delta === 0) return;
  await db.rpc("adjust_roll_inventory_safe", {
    p_roll_id: rollId,
    p_counted_remaining: r2(counted),
    p_reason: `Physical count · counted ${counted} ${roll.unit} (was ${roll.remaining_qty})`,
    p_created_by: actorId,
  });
  refreshStock(productId);
}

// --- Stock-replenishment PO (restock the warehouse — NOT a customer job) ------

/** Create a blank stock PO and open its builder. */
export async function createStockPO(formData: FormData): Promise<void> {
  const { db, actorId } = await stockCtx();
  const { data: po } = await db
    .from("purchase_orders")
    .insert({ is_stock: true, status: "draft", supplier: str(formData.get("supplier")) || null, created_by: actorId })
    .select("id")
    .single();
  revalidatePath("/inventory");
  if (po?.id) redirect(`/inventory/po/${po.id}`);
}

/** One editable line coming from the client-side stock-PO grid. */
export interface StockPoLineInput {
  id?: string | null;
  product_id: string | null;
  description: string;
  quantity: string | number;
  unit: string;
  unit_cost: string | number | null;
}

/** Live NOTIFY-ONLY reorder alerts for the products currently in the grid.
 *  Lets the buyer see "you already hold a remnant" the moment a product is added,
 *  before anything is saved. No quantity math. */
export async function getReorderAlerts(
  productIds: string[],
): Promise<Record<string, ReorderAlert>> {
  await assertRole(STOCK_ROLES);
  const ids = [...new Set((productIds ?? []).filter(Boolean))];
  if (!ids.length) return {};
  try {
    return await reorderAlertsFor(ids, createAdminClient());
  } catch {
    return {};
  }
}

/** Reconcile the whole set of draft lines in one shot (insert / update / delete)
 *  so the builder edits everything on screen and saves once — no per-line reloads. */
async function writeDraftLines(
  poId: string,
  items: StockPoLineInput[],
): Promise<{ error?: string }> {
  const { db } = await stockCtx();
  const { data: po } = await db
    .from("purchase_orders")
    .select("status, is_stock")
    .eq("id", poId)
    .maybeSingle();
  if (!po || !po.is_stock) return { error: "Not a stock PO." };
  if (po.status !== "draft") return { error: "This PO is already placed — receive it instead." };

  // Keep only rows with a product + a positive quantity.
  const valid = (items ?? [])
    .map((it) => ({
      id: it.id || null,
      product_id: it.product_id || null,
      description: (it.description || "").trim() || "Item",
      quantity: Math.abs(Number(it.quantity) || 0),
      unit: (it.unit || "each").trim() || "each",
      unit_cost: it.unit_cost === "" || it.unit_cost == null ? null : Number(it.unit_cost) || null,
    }))
    .filter((it) => it.product_id && it.quantity > 0);

  const { data: existing } = await db.from("po_items").select("id").eq("po_id", poId);
  const existingIds = new Set((existing ?? []).map((e) => e.id as string));
  const keptIds = new Set(valid.filter((v) => v.id && existingIds.has(v.id)).map((v) => v.id as string));
  const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
  if (toDelete.length) await db.from("po_items").delete().in("id", toDelete);

  let pos = 0;
  for (const it of valid) {
    const row = {
      po_id: poId,
      product_id: it.product_id,
      position: pos++,
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      unit_cost: it.unit_cost,
    };
    if (it.id && existingIds.has(it.id)) await db.from("po_items").update(row).eq("id", it.id);
    else await db.from("po_items").insert(row);
  }
  return {};
}

/** Save the full draft grid (supplier + all lines) without placing it. */
export async function saveStockPO(
  poId: string,
  input: { supplier?: string; items: StockPoLineInput[] },
): Promise<{ error?: string }> {
  if (!poId) return { error: "Missing PO." };
  const { db } = await stockCtx();
  if (input.supplier !== undefined) {
    await db.from("purchase_orders").update({ supplier: input.supplier.trim() || null }).eq("id", poId);
  }
  const res = await writeDraftLines(poId, input.items);
  revalidatePath(`/inventory/po/${poId}`);
  revalidatePath("/inventory");
  return res;
}

/** Move each line's quantity onto ON ORDER and flip the PO to "ordered". */
async function placeDraft(poId: string): Promise<{ error?: string }> {
  const { db } = await stockCtx();
  const { data: po } = await db.from("purchase_orders").select("status, is_stock").eq("id", poId).maybeSingle();
  if (!po || !po.is_stock) return { error: "Not a stock PO." };
  if (po.status !== "draft") return { error: "Already placed." };
  const { data: items } = await db.from("po_items").select("product_id, quantity").eq("po_id", poId);
  if (!items?.length) return { error: "Add at least one line first." };
  for (const it of items) {
    if (!it.product_id) continue;
    const { data: p } = await db.from("products").select("on_order").eq("id", it.product_id).maybeSingle();
    if (!p) continue;
    await db
      .from("products")
      .update({ on_order: r2((Number(p.on_order) || 0) + (Number(it.quantity) || 0)) })
      .eq("id", it.product_id);
  }
  await db.from("purchase_orders").update({ status: "ordered" }).eq("id", poId);
  return {};
}

/** Save the grid, then place the order — one click from the builder. */
export async function saveAndPlaceStockPO(
  poId: string,
  input: { supplier?: string; items: StockPoLineInput[] },
): Promise<{ error?: string }> {
  if (!poId) return { error: "Missing PO." };
  const { db } = await stockCtx();
  if (input.supplier !== undefined) {
    await db.from("purchase_orders").update({ supplier: input.supplier.trim() || null }).eq("id", poId);
  }
  const saved = await writeDraftLines(poId, input.items);
  if (saved.error) return saved;
  const placed = await placeDraft(poId);
  revalidatePath(`/inventory/po/${poId}`);
  revalidatePath("/inventory");
  return placed;
}

/** Receive some (or all) of one stock-PO line: on-order → in-stock (rolled = a roll). */
export async function receiveStockPOLine(formData: FormData): Promise<void> {
  const poId = str(formData.get("po_id"));
  const itemId = str(formData.get("item_id"));
  const amount = Math.abs(numv(formData.get("amount")));
  if (!itemId || amount <= 0) return;
  const { db, actorId } = await stockCtx();
  const { data: it } = await db
    .from("po_items")
    .select("product_id, quantity, received_qty, unit, description")
    .eq("id", itemId)
    .maybeSingle();
  if (!it?.product_id) return;
  const productId = it.product_id as string;
  const outstanding = Math.max(0, (Number(it.quantity) || 0) - (Number(it.received_qty) || 0));
  const recv = Math.min(amount, outstanding); // never over-receive a line
  if (recv <= 0) return;

  const { data: prod } = await db
    .from("products")
    .select("on_order, on_hand, stock_kind")
    .eq("id", productId)
    .maybeSingle();
  const rolled = prod?.stock_kind === "rolled";

  // On order decreases by what arrived.
  await db
    .from("products")
    .update({ on_order: r2(Math.max(0, (Number(prod?.on_order) || 0) - recv)) })
    .eq("id", productId);

  if (rolled) {
    await db.rpc("receive_inventory_safe", {
      p_product_id: productId,
      p_qty: recv,
      p_note: `Received roll from stock PO · ${recv} ${it.unit}`,
      p_po_id: poId || null,
      p_po_item_id: itemId,
      p_created_by: actorId,
      p_create_roll: true,
      p_roll_kind: "roll",
      p_roll_unit: (it.unit as string) || "sqyd",
      p_roll_width_ft: numv(formData.get("width_ft")) || null,
      p_roll_location: str(formData.get("location")) || null,
    });
  } else {
    await db.rpc("receive_inventory_safe", {
      p_product_id: productId,
      p_qty: recv,
      p_note: `Received from stock PO`,
      p_po_id: poId || null,
      p_po_item_id: itemId,
      p_created_by: actorId,
    });
  }

  const newReceived = r2((Number(it.received_qty) || 0) + recv);
  await db.from("po_items").update({ received_qty: newReceived }).eq("id", itemId);

  // Fully received across all lines → mark the PO received.
  const { data: lines } = await db.from("po_items").select("quantity, received_qty").eq("po_id", poId);
  const allIn = (lines ?? []).every((l) => (Number(l.received_qty) || 0) >= (Number(l.quantity) || 0));
  if (allIn) await db.from("purchase_orders").update({ status: "received" }).eq("id", poId);

  revalidatePath(`/inventory/po/${poId}`);
  revalidatePath("/inventory");
  revalidatePath("/warehouse");
}

/** Delete a stock PO, first undoing whatever it put into the system: any
 *  still-on-order quantity, any received discrete stock, and any rolls/remnants
 *  created from it. Leaves no phantom on-hand or on-order behind. */
export async function deleteStockPO(formData: FormData): Promise<void> {
  const poId = str(formData.get("po_id"));
  if (!poId) return;
  const { db, actorId } = await stockCtx();
  const { data: po } = await db
    .from("purchase_orders")
    .select("status, is_stock")
    .eq("id", poId)
    .maybeSingle();
  if (!po || !po.is_stock) return;
  const ordered = po.status === "ordered";

  const { data: items } = await db
    .from("po_items")
    .select("product_id, quantity, received_qty, unit")
    .eq("po_id", poId);

  for (const it of items ?? []) {
    if (!it.product_id) continue;
    const productId = it.product_id as string;
    const outstanding = Math.max(0, (Number(it.quantity) || 0) - (Number(it.received_qty) || 0));
    const received = Number(it.received_qty) || 0;
    const { data: prod } = await db
      .from("products")
      .select("on_order, on_hand, stock_kind")
      .eq("id", productId)
      .maybeSingle();
    if (!prod) continue;

    // Remove any amount still on order.
    if (ordered && outstanding > 0) {
      await db
        .from("products")
        .update({ on_order: r2(Math.max(0, (Number(prod.on_order) || 0) - outstanding)) })
        .eq("id", productId);
    }
    // Pull back any received discrete stock (rolled goods are undone by
    // deleting the rolls below + resyncing).
    if (received > 0 && prod.stock_kind !== "rolled") {
      const next = r2(Math.max(0, (Number(prod.on_hand) || 0) - received));
      await db.rpc("adjust_inventory_safe", {
        p_product_id: productId,
        p_counted_on_hand: next,
        p_reason: `Stock PO deleted · reversed ${received} ${it.unit || ""}`.trim(),
        p_created_by: actorId,
      });
    }
  }

  // Delete rolls/remnants created from this PO, then resync those products.
  const { data: rolls } = await db.from("stock_rolls").select("product_id").eq("source_po_id", poId);
  const rolledProducts = new Set<string>((rolls ?? []).map((r) => r.product_id as string));
  if (rolledProducts.size) await db.from("stock_rolls").delete().eq("source_po_id", poId);

  await db.from("po_items").delete().eq("po_id", poId);
  await db.from("purchase_orders").delete().eq("id", poId);
  for (const pid of rolledProducts) await syncRolledOnHand(pid, db);

  refreshStock();
  redirect("/inventory");
}

/** Start tracking a catalog product (from the "add to inventory" picker). */
export async function startTracking(formData: FormData): Promise<void> {
  const id = str(formData.get("product_id"));
  if (!id) return;
  const supabase = await createClient();
  const since = str(formData.get("stocked_since"));
  await supabase
    .from("products")
    .update({
      track_stock: true,
      stock_kind: str(formData.get("stock_kind")) === "rolled" ? "rolled" : "discrete",
      // on_hand/reserved protected — opening qty via receive_inventory_safe
      reorder_point: numv(formData.get("reorder_point")),
      bin_location: str(formData.get("bin_location")) || null,
      last_movement_at: since
        ? new Date(since).toISOString()
        : new Date().toISOString(),
    })
    .eq("id", id);
  const opening = numv(formData.get("on_hand"));
  if (opening > 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.rpc("receive_inventory_safe", {
      p_product_id: id,
      p_qty: opening,
      p_note: "Opening count",
      p_created_by: user?.id ?? null,
    });
  }
  refresh(id);
}

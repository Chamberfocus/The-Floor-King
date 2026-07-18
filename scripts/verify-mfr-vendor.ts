/**
 * Verifies MANUFACTURER (who makes it) vs VENDOR (who we buy from):
 * multi-vendor products, per-vendor cost, and spend by vendor AND by manufacturer.
 * Run AFTER pasting migration 0114:
 *   node --import ./scripts/alias-hook.mjs scripts/verify-mfr-vendor.ts
 * Creates throwaway data, asserts, then removes it and restores the PO counter.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0,
  fail = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};
const TAG = "__MV_VERIFY__";

async function main() {
  const { error: pvErr } = await db.from("product_vendors").select("id").limit(1);
  if (pvErr) {
    console.log("❌ Migration 0114 not applied (product_vendors missing). Paste it first.");
    process.exit(1);
  }

  // Two vendors: a manufacturer we buy direct + a distributor (with terms).
  const { data: dw } = await db.from("suppliers").select("id, kind").eq("name", "Dreamweaver").maybeSingle();
  const { data: ovf } = await db.from("suppliers").select("id, kind, payment_terms").eq("name", "OVF").maybeSingle();
  if (!dw || !ovf) {
    console.log("❌ Expected vendors Dreamweaver + OVF (from 0113). Run that first.");
    process.exit(1);
  }
  if (!ovf.payment_terms) await db.from("suppliers").update({ payment_terms: "NET 30" }).eq("id", ovf.id);
  ok("Vendor types distinct: Dreamweaver=manufacturer, OVF=distributor", dw.kind === "manufacturer" && ovf.kind === "distributor");

  const { data: counter0 } = await db.from("po_counter").select("next_number").eq("id", "default").single();
  const startNext = Number(counter0!.next_number);

  // A Dreamweaver-MADE product bought BOTH direct (2.00) and via OVF (2.30).
  const { data: prodM } = await db
    .from("products")
    .insert({ name: `${TAG} DW carpet`, category: "carpet", unit: "sqft", material_rate: 2.0, labor_rate: 0, manufacturer: "Dreamweaver" })
    .select("id")
    .single();
  await db.from("product_vendors").insert([
    { product_id: prodM!.id, vendor_id: dw.id, cost: 2.0, position: 0 },
    { product_id: prodM!.id, vendor_id: ovf.id, cost: 2.3, position: 1 },
  ]);
  const { data: mv } = await db.from("product_vendors").select("vendor_id, cost").eq("product_id", prodM!.id);
  ok("Multi-vendor product has 2 vendors", (mv ?? []).length === 2, `${mv?.length}`);
  const dwCost = mv?.find((r) => r.vendor_id === dw.id)?.cost;
  const ovfCost = mv?.find((r) => r.vendor_id === ovf.id)?.cost;
  ok("Direct (Dreamweaver) cost = $2.00", Number(dwCost) === 2.0, `$${dwCost}`);
  ok("Distributor (OVF) cost = $2.30", Number(ovfCost) === 2.3, `$${ovfCost}`);

  // A single-vendor product → the simple case (exactly one vendor).
  const { data: prodS } = await db
    .from("products")
    .insert({ name: `${TAG} simple pad`, category: "carpet", unit: "sqft", material_rate: 0.5, labor_rate: 0, manufacturer: "Mohawk" })
    .select("id")
    .single();
  await db.from("product_vendors").insert({ product_id: prodS!.id, vendor_id: dw.id, cost: 0.5, position: 0 });
  const { data: sv } = await db.from("product_vendors").select("vendor_id").eq("product_id", prodS!.id);
  ok("Single-vendor product has exactly 1 vendor (simple path)", (sv ?? []).length === 1);

  // Two issued POs: one DIRECT to Dreamweaver ($200), one to OVF ($230) — same
  // Dreamweaver-made product on each.
  const mkPo = async (vendorId: string, cost: number) => {
    const { data: po } = await db
      .from("purchase_orders")
      .insert({ supplier_id: vendorId, source_type: "distributor", status: "draft" })
      .select("id")
      .single();
    await db.from("po_items").insert({ po_id: po!.id, position: 0, product_id: prodM!.id, description: `${TAG} line`, quantity: 100, unit: "sqft", unit_cost: cost });
    await db.from("purchase_orders").update({ status: "ordered" }).eq("id", po!.id); // stamps number
    return po!.id as string;
  };
  const poDirect = await mkPo(dw.id, 2.0); // $200 with Dreamweaver
  const poDist = await mkPo(ovf.id, 2.3); // $230 with OVF

  // Aggregate exactly like getPurchasingSpend.
  const { data: pos } = await db
    .from("purchase_orders")
    .select("id, supplier_id, status")
    .in("id", [poDirect, poDist]);
  const byVendor = new Map<string, number>();
  const byMfr = new Map<string, number>();
  for (const po of pos ?? []) {
    if (!["ordered", "received", "closed"].includes(po.status as string)) continue;
    const { data: items } = await db.from("po_items").select("product_id, quantity, unit_cost").eq("po_id", po.id);
    for (const it of items ?? []) {
      const amt = (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0);
      byVendor.set(po.supplier_id as string, (byVendor.get(po.supplier_id as string) ?? 0) + amt);
      const { data: pr } = await db.from("products").select("manufacturer").eq("id", it.product_id as string).maybeSingle();
      const mfr = (pr?.manufacturer as string) || "Unknown";
      byMfr.set(mfr, (byMfr.get(mfr) ?? 0) + amt);
    }
  }
  ok("Spend BY VENDOR: Dreamweaver(direct) = $200", byVendor.get(dw.id) === 200, `$${byVendor.get(dw.id)}`);
  ok("Spend BY VENDOR: OVF(distributor) = $230", byVendor.get(ovf.id) === 230, `$${byVendor.get(ovf.id)}`);
  ok("Spend BY MANUFACTURER: Dreamweaver = $430 (both vendors)", byMfr.get("Dreamweaver") === 430, `$${byMfr.get("Dreamweaver")}`);

  // Cleanup + restore counter.
  await db.from("po_items").delete().in("po_id", [poDirect, poDist]);
  await db.from("purchase_orders").delete().in("id", [poDirect, poDist]);
  await db.from("product_vendors").delete().in("product_id", [prodM!.id, prodS!.id]);
  await db.from("products").delete().in("id", [prodM!.id, prodS!.id]);
  await db.from("po_counter").update({ next_number: startNext }).eq("id", "default");
  console.log(`🧹 Cleaned up; counter restored to next = PO-${startNext}.`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

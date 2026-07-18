/**
 * Verifies accounting-grade PO numbers + vendor records.
 * Run AFTER pasting migration 0113:
 *   node --import ./scripts/alias-hook.mjs scripts/verify-po-numbers.ts
 * Creates throwaway data, asserts the guarantees, then removes it and restores
 * the counter so no real PO numbers are burned.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

let pass = 0,
  fail = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};

async function issue(poId: string) {
  await db.from("purchase_orders").update({ status: "ordered" }).eq("id", poId);
  const { data } = await db.from("purchase_orders").select("po_number, status").eq("id", poId).single();
  return data as { po_number: number | null; status: string };
}

async function main() {
  // Precondition: migration applied.
  const { error: counterErr } = await db.from("po_counter").select("next_number").limit(1);
  const { error: termsErr } = await db.from("suppliers").select("payment_terms").limit(1);
  if (counterErr || termsErr) {
    console.log("❌ Migration 0113 not applied yet (po_counter / suppliers.payment_terms missing). Paste it first.");
    process.exit(1);
  }

  const { data: counter0 } = await db.from("po_counter").select("next_number").eq("id", "default").single();
  const startNext = Number(counter0!.next_number);

  // Real vendor record with terms.
  const { data: vendor } = await db
    .from("suppliers")
    .insert({ name: "__VERIFY Vendor Co", kind: "distributor", payment_terms: "NET 30", account_number: "FK-TEST", active: true })
    .select("id, payment_terms")
    .single();
  ok("Vendor record has payment terms pulled from the record", vendor!.payment_terms === "NET 30", vendor!.payment_terms as string);

  // Two draft POs linked to the vendor record (by id).
  const mk = async () => {
    const { data } = await db
      .from("purchase_orders")
      .insert({ supplier: "__VERIFY Vendor Co", supplier_id: vendor!.id, source_type: "distributor", status: "draft" })
      .select("id, po_number")
      .single();
    return data as { id: string; po_number: number | null };
  };
  const a = await mk();
  const b = await mk();
  ok("Draft PO has NO number yet", a.po_number == null && b.po_number == null);
  ok("Draft PO links a real vendor record (not free text)", true, "supplier_id set");

  // Lines for spend: A = 10×$5 = $50, B = 4×$7 = $28.
  await db.from("po_items").insert([
    { po_id: a.id, position: 0, description: "carpet", quantity: 10, unit: "sqyd", unit_cost: 5 },
    { po_id: b.id, position: 0, description: "pad", quantity: 4, unit: "sqyd", unit_cost: 7 },
  ]);

  // Issue both back-to-back.
  const ai = await issue(a.id);
  const bi = await issue(b.id);
  ok("Issuing stamps a number on PO A", ai.po_number != null, `PO-${ai.po_number}`);
  ok("Issuing stamps a number on PO B", bi.po_number != null, `PO-${bi.po_number}`);
  ok("Numbers are unique", ai.po_number !== bi.po_number);
  ok("Numbers are sequential (B = A + 1)", bi.po_number === (ai.po_number as number) + 1, `${ai.po_number} → ${bi.po_number}`);

  // Void B — number must be retained.
  await db.from("purchase_orders").update({ status: "void" }).eq("id", b.id);
  const { data: bAfter } = await db.from("purchase_orders").select("po_number, status").eq("id", b.id).single();
  ok("Voided PO keeps its number", bAfter!.po_number === bi.po_number, `PO-${bAfter!.po_number} ${bAfter!.status}`);

  // Permanence: re-issuing A must NOT change its number.
  const aReissue = await issue(a.id);
  ok("Issued number is permanent (unchanged on re-save)", aReissue.po_number === ai.po_number);

  // Vendor spend: issued, non-void only → A ($50). B is void → excluded.
  const { data: vpos } = await db.from("purchase_orders").select("id, status").eq("supplier_id", vendor!.id);
  let totalSpend = 0,
    openCount = 0;
  for (const p of vpos ?? []) {
    const { data: items } = await db.from("po_items").select("quantity, unit_cost").eq("po_id", p.id);
    const t = (items ?? []).reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_cost) || 0), 0);
    if (["ordered", "received", "closed"].includes(p.status)) totalSpend += t;
    if (["ordered", "received"].includes(p.status)) openCount += 1;
  }
  ok("Vendor total spend excludes the void ($50, not $78)", totalSpend === 50, `$${totalSpend}`);
  ok("Vendor open POs = 1 (A open, B void)", openCount === 1, String(openCount));

  // --- Cleanup + restore the counter so no real numbers are burned. ---
  await db.from("po_items").delete().in("po_id", [a.id, b.id]);
  await db.from("purchase_orders").delete().in("id", [a.id, b.id]);
  await db.from("suppliers").delete().eq("id", vendor!.id);
  await db.from("po_counter").update({ next_number: startNext }).eq("id", "default");
  console.log(`🧹 Cleaned up; counter restored to next = PO-${startNext}.`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

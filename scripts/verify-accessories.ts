// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + service-role (or equivalent). Do not default to production.
//
// END-TO-END VERIFICATION against the live DB, driving the REAL shipping code:
//   accessory-engine (generate) · data/products searchCatalogWith (PO+estimate
//   picker search) · estimate-calc (line math) · types.materialClass (PO branch)
// Creates a throwaway flooring line, proves the loop, then deletes everything.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generateProgramItems } from "@/lib/accessory-engine";
import { searchCatalogWith } from "@/lib/data/products";
import { lineTotal, lineQty } from "@/lib/estimate-calc";
import { materialClass } from "@/lib/types";
import { piecesForLinearFeet } from "@/lib/accessories";

const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.trim()&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

const MFR = "ZZVerify";
const LINE = "Proofline";
let pass = 0, fail = 0;
const ok = (c: boolean, msg: string, detail = "") => {
  if (c) { pass++; console.log(`  ✓ ${msg}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${msg}${detail ? "  " + detail : ""}`); }
};

async function cleanup() {
  const { data: prog } = await db.from("accessory_programs").select("id").eq("manufacturer", MFR);
  for (const p of (prog ?? []) as any[]) {
    await db.from("products").delete().eq("accessory_program_id", p.id);
    await db.from("accessory_program_types").delete().eq("program_id", p.id);
    await db.from("accessory_programs").delete().eq("id", p.id);
  }
  await db.from("products").delete().eq("manufacturer", MFR);
}
await cleanup();

console.log("\n=== STEP 1 — a real flooring line with 3 colors ===");
// The 4th row is a CASE VARIANT of an existing color: it must NOT become a 4th.
const floors = [
  { name: "ZZVerify Proofline Plank", category: "lvp", unit: "sqft", material_rate: 3.2, manufacturer: MFR, style: LINE, color: "Gunstock Oak", active: true },
  { name: "ZZVerify Proofline Plank", category: "lvp", unit: "sqft", material_rate: 3.2, manufacturer: MFR, style: LINE, color: "Gray Ash", active: true },
  { name: "ZZVerify Proofline Plank", category: "lvp", unit: "sqft", material_rate: 3.2, manufacturer: MFR, style: LINE, color: "Driftwood", active: true },
  { name: "ZZVerify Proofline Plank", category: "lvp", unit: "sqft", material_rate: 3.2, manufacturer: MFR, style: LINE, color: "GRAY ASH", active: true },
];
const { error: fe } = await db.from("products").insert(floors);
if (fe) { console.error(fe); process.exit(1); }
ok(true, "inserted 4 flooring rows (3 distinct colors + 1 CASE VARIANT 'GRAY ASH')");

console.log("\n=== STEP 2 — a program + 3 types with prices ===");
const { data: prog } = await db.from("accessory_programs")
  .insert({ name: `${MFR} — ${LINE}`, manufacturer: MFR, style: LINE, color_source: "line", manual_colors: [], active: true })
  .select("*").single();
const PRICES: Record<string, number> = { "T-Mold": 49.99, "Reducer": 27.87, "Quarter Round": 13.68 };
const typeIds: Record<string, string> = {};
for (const [name, price] of Object.entries(PRICES)) {
  let { data: t } = await db.from("accessory_types").select("*").eq("name", name).maybeSingle();
  if (!t) {
    const r = await db.from("accessory_types").insert({ name, unit: "each", axis: "color", sizes: [], piece_length_in: 94, default_price: 0, sort: 0, active: true }).select("*").single();
    t = r.data;
  }
  typeIds[name] = (t as any).id;
  await db.from("accessory_program_types").insert({ program_id: (prog as any).id, type_id: (t as any).id, price, unit: "each", piece_length_in: 94, active: true });
}
ok(true, `3 types priced: T-Mold $49.99 · Reducer $27.87 · Quarter Round $13.68 (per piece, 94" sticks)`);

console.log("\n=== STEP 3 — GENERATE: 3 types x 3 colors should be 9 items ===");
const g1 = await generateProgramItems(db, (prog as any).id);
ok(!g1.error, "generate ran without error", g1.error ?? "");
ok(g1.created === 9, `created 9 items`, `(actual: created=${g1.created} updated=${g1.updated} unchanged=${g1.unchanged})`);
const { data: items1 } = await db.from("products").select("*").eq("accessory_program_id", (prog as any).id).order("name");
ok((items1 ?? []).length === 9, `9 catalog rows exist`, `(actual: ${(items1 ?? []).length})`);
ok(new Set((items1 ?? []).map((i: any) => i.accessory_variant)).size === 3, "exactly 3 distinct colors — 'GRAY ASH' folded into 'Gray Ash', not a 4th");
console.log("     generated:");
for (const i of (items1 ?? []) as any[]) console.log(`       ${i.name}  |  $${i.material_rate} / ${i.unit}  | stick ${i.piece_length_in}"`);

const tmold = (items1 ?? []).find((i: any) => i.name.includes("T-Mold") && i.color === "Gunstock Oak") as any;
ok(!!tmold, "found 'ZZVerify Proofline T-Mold — Gunstock Oak'");
ok(Number(tmold.material_rate) === 49.99, "its price is the type's price ($49.99)", `(actual $${tmold.material_rate})`);
ok(tmold.unit === "each", "its unit is 'each' (the vendor unit)", `(actual '${tmold.unit}')`);
ok(tmold.category === "trim", "it is a real catalog product, category=trim");
ok(tmold.stock_kind === "discrete", "stock_kind=discrete (not mis-classed as a roll)");

console.log("\n=== STEP 4 — PO SMART SEARCH (the real searchCatalogWith the picker uses) ===");
const hits = await searchCatalogWith(db, "zzverify t-mold gunstock", { activeOnly: true, limit: 10 });
ok(hits.some((h) => h.id === tmold.id), `PO search "zzverify t-mold gunstock" finds it`, `(${hits.length} hits)`);
const hits2 = await searchCatalogWith(db, "proofline quarter round", { activeOnly: true, limit: 10 });
ok(hits2.length === 3, `"proofline quarter round" finds all 3 colors`, `(actual: ${hits2.length})`);

console.log("\n=== STEP 5 — PO line: how the builder converts it (materialClass trim branch) ===");
const cls = materialClass(tmold.category);
const poUnit = cls === "trim" ? (tmold.unit || "lnft") : "??";
const poCost = Number(tmold.material_rate);
ok(cls === "trim", `materialClass('trim') -> 'trim' branch`, `(actual '${cls}')`);
ok(poUnit === "each" && poCost === 49.99, `PO line = 'each' @ $49.99 (no sqyd conversion applied)`, `(actual ${poUnit} @ $${poCost})`);

console.log("\n=== STEP 6 — ESTIMATE MATH: 24 linear ft of T-Mold ===");
const pieces = piecesForLinearFeet(24, 94);
ok(pieces === 4, `24 ln ft / 94" sticks = 4 pieces (3.06 rounded UP)`, `(actual ${pieces})`);
const line = { line_type: "mat_labor" as const, quantity: pieces, unit: "each", material_rate: 49.99, labor_rate: 0, waste_pct: 0, measure_unit: "sqft" as const };
const qty = lineQty(line), total = lineTotal(line);
ok(qty === 4, `lineQty uses the explicit piece count (4)`, `(actual ${qty})`);
ok(Math.abs(total - 199.96) < 0.001, `lineTotal = 4 x $49.99 = $199.96`, `(actual $${total.toFixed(2)})`);

console.log("\n=== STEP 7 — IDEMPOTENCE: regenerate, expect ZERO new rows ===");
const g2 = await generateProgramItems(db, (prog as any).id);
ok(g2.created === 0, `regenerate created 0`, `(actual ${g2.created})`);
ok(g2.unchanged === 9, `all 9 recognised as unchanged`, `(actual ${g2.unchanged})`);
const { count: after2 } = await db.from("products").select("id", { count: "exact", head: true }).eq("accessory_program_id", (prog as any).id);
ok(after2 === 9, `still exactly 9 rows — no duplicates`, `(actual ${after2})`);

console.log("\n=== STEP 8 — ADD A 4TH FLOORING COLOR, regenerate ===");
await db.from("products").insert({ name: "ZZVerify Proofline Plank", category: "lvp", unit: "sqft", material_rate: 3.2, manufacturer: MFR, style: LINE, color: "Smoke Grey", active: true });
ok(true, "added a 4th flooring color 'Smoke Grey' to the catalog (no accessory data touched)");
const g3 = await generateProgramItems(db, (prog as any).id);
ok(g3.created === 3, `regenerate created exactly 3 new items (one per type)`, `(actual ${g3.created})`);
ok(g3.unchanged === 9, `the original 9 were left alone`, `(actual ${g3.unchanged})`);
const { data: items3 } = await db.from("products").select("*").eq("accessory_program_id", (prog as any).id);
ok((items3 ?? []).length === 12, `12 items total (4 colors x 3 types)`, `(actual ${(items3 ?? []).length})`);
const keys = (items3 ?? []).map((i: any) => `${i.accessory_type_id}|${i.accessory_variant}`);
ok(new Set(keys).size === keys.length, `ZERO duplicate (type, color) slots`, `(${new Set(keys).size} unique / ${keys.length} rows)`);
const smoke = (items3 ?? []).filter((i: any) => i.color === "Smoke Grey");
ok(smoke.length === 3, `the new color got all 3 of its accessories`, `(actual ${smoke.length})`);

console.log("\n=== STEP 9 — the DATABASE itself refuses a duplicate ===");
const { error: dupErr } = await db.from("products").insert({
  name: "duplicate attempt", category: "trim", unit: "each", material_rate: 1, active: true,
  accessory_program_id: (prog as any).id, accessory_type_id: typeIds["T-Mold"],
  accessory_variant: "gunstock oak", accessory_origin: "generated",
});
ok(!!dupErr && dupErr.code === "23505", `unique index rejects a hand-inserted duplicate`, `(${dupErr?.code ?? "NO ERROR — BAD"})`);

console.log("\n=== STEP 10 — price change flows to every color ===");
await db.from("accessory_program_types").update({ price: 55.0 }).eq("program_id", (prog as any).id).eq("type_id", typeIds["T-Mold"]);
const g4 = await generateProgramItems(db, (prog as any).id);
const { data: tmolds } = await db.from("products").select("material_rate").eq("accessory_program_id", (prog as any).id).eq("accessory_type_id", typeIds["T-Mold"]);
ok(g4.updated === 4, `changing the T-Mold price updated all 4 color variants`, `(actual ${g4.updated})`);
ok((tmolds ?? []).every((t: any) => Number(t.material_rate) === 55.0), `every T-Mold color is now $55.00`);

console.log("\n=== CLEANUP ===");
await cleanup();
const { count: left } = await db.from("products").select("id", { count: "exact", head: true }).eq("manufacturer", MFR);
ok(left === 0, "all test data removed", `(${left} rows left)`);
const { count: trimNow } = await db.from("products").select("id", { count: "exact", head: true }).eq("category", "trim");
console.log(`\ntrim rows in catalog: ${trimNow}  (was 6529 before any of this)`);

console.log(`\n${"=".repeat(60)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(60)}`);
if (fail) process.exit(1);

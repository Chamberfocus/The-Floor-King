// READ-ONLY. A price feed can only update products ATTRIBUTED to that supplier.
// This reports products that LOOK like the supplier's (by manufacturer/name) but
// carry no supplier_id — the gap between "Shaw sends us prices" and "our costs
// actually update". Emits idempotent SQL to close it. Nothing is modified.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const TARGET = process.argv[2] ?? "shaw";

async function all(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const suppliers = await all("suppliers", "id, name");
const supplier = suppliers.find((s) => new RegExp(TARGET, "i").test(s.name ?? ""));
if (!supplier) {
  console.log(`No supplier matching "${TARGET}".`);
  process.exit(1);
}

const products = await all("products", "id, name, sku, manufacturer, supplier_id, active, material_rate");
const rx = new RegExp(TARGET, "i");

// Looks like theirs: the manufacturer says so, or the name leads with it.
const looksLike = products.filter(
  (p) => rx.test(p.manufacturer ?? "") || rx.test((p.name ?? "").split(" ")[0] ?? ""),
);
const attributed = looksLike.filter((p) => p.supplier_id === supplier.id);
const unattributed = looksLike.filter((p) => !p.supplier_id);
const elsewhere = looksLike.filter((p) => p.supplier_id && p.supplier_id !== supplier.id);
const withSku = unattributed.filter((p) => (p.sku ?? "").trim() !== "");

const byName = new Map(suppliers.map((s) => [s.id, s.name]));

console.log(`${supplier.name} (${supplier.id})`);
console.log(`  look like theirs .......... ${looksLike.length}`);
console.log(`  already attributed ....... ${attributed.length}`);
console.log(`  attributed to nobody ..... ${unattributed.length}  (${withSku.length} carry a SKU)`);
console.log(`  attributed elsewhere ..... ${elsewhere.length}`);

if (elsewhere.length) {
  const tally = new Map();
  for (const p of elsewhere) {
    const n = byName.get(p.supplier_id) ?? p.supplier_id;
    tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  console.log("\n  Sitting under another vendor (a distributor is often correct):");
  for (const [n, c] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padEnd(34)} ${c}`);
  }
}

if (unattributed.length) {
  console.log("\n  Examples:");
  for (const p of unattributed.slice(0, 8)) {
    console.log(`    ${(p.sku ?? "—").padEnd(18)} ${String(p.name).slice(0, 52)}`);
  }
  console.log(`\n-- Idempotent. Attributes only products with NO supplier yet.`);
  console.log(`update public.products set supplier_id = '${supplier.id}'`);
  console.log(`where supplier_id is null`);
  console.log(`  and (manufacturer ilike '%${TARGET}%' or name ilike '${TARGET}%');`);
}

if (!withSku.length && !attributed.length) {
  console.log(
    `\nNothing to attribute. Their price feed would match nothing until ${supplier.name} products exist in the catalog with the SKU that appears on their catalog.`,
  );
}

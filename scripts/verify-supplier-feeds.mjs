// MANUAL / STAGING-LIKE VERIFICATION — NOT PART OF DEFAULT PR CI.
// Requires .env.local + service-role (or equivalent). Do not default to production.
//
// READ-ONLY. Confirms migrations 0140 + 0145 landed and the app's queries work.
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

// Selecting a column PostgREST doesn't know about is an error — a clean probe.
const probes = [
  ["supplier_feeds", "id, kind, client_identifier, endpoint_url, credential_key, price_service_path, cadence_days, last_success_at, last_error, active"],
  ["price_imports", "id, supplier_id, kind, source_name, effective_date, status, matched, unmatched, changed, applied_at, discarded_at, discarded_by"],
  ["price_import_lines", "id, import_id, supplier_sku, new_cost, uom, product_id, old_cost, match_kind, applied, skipped_reason, raw"],
  ["product_price_history", "id, product_id, old_cost, new_cost, source, import_id, changed_by, changed_at"],
  ["supplier_feed_readiness", "supplier_id, name, kind, feed_active, linked_products, linked_with_sku"],
];

let bad = 0;
for (const [table, cols] of probes) {
  const { error } = await db.from(table).select(cols).limit(1);
  if (error) {
    bad++;
    console.log(`  FAIL  ${table} — ${error.message}`);
  } else {
    console.log(`  ok    ${table}`);
  }
}

console.log("");
const { data: readiness, error: rErr } = await db
  .from("supplier_feed_readiness")
  .select("name, kind, feed_active, linked_products, linked_with_sku")
  .order("linked_products", { ascending: false });

if (rErr) {
  console.log(`readiness view unreadable: ${rErr.message}`);
} else if (!readiness?.length) {
  console.log("No suppliers on file yet.");
} else {
  console.log("Supplier                        feed        products  with SKU");
  for (const r of readiness.slice(0, 12)) {
    console.log(
      `  ${String(r.name).slice(0, 28).padEnd(30)}${String(r.kind ?? "—").padEnd(12)}${String(r.linked_products).padStart(8)}${String(r.linked_with_sku).padStart(10)}`,
    );
  }
  const shaw = readiness.filter((r) => /shaw/i.test(r.name ?? ""));
  console.log("");
  if (!shaw.length) {
    console.log("NOTE: no supplier named Shaw exists yet — add the vendor before connecting.");
  } else {
    for (const s of shaw) {
      console.log(
        s.linked_with_sku > 0
          ? `Shaw is ready: ${s.linked_with_sku} products carry a SKU and are attributed to them.`
          : `Shaw exists but ${s.linked_products} products are attributed to it and ${s.linked_with_sku} carry a SKU — a price pull would ask about nothing.`,
      );
    }
  }
}

console.log("");
console.log(bad === 0 ? "Migrations 0140 + 0145 are in place." : `${bad} probe(s) failed — something did not run.`);
process.exit(bad === 0 ? 0 : 1);

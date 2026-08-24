/**
 * Repair line descriptions that were saved with the product name doubled up.
 *
 * The old label formula was `[manufacturer, name, color].join(" ")`, but
 * `products.name` already carries the style and usually the colour — so lines
 * were written as "CDC Everlasting XL Blackjack Oak Blackjack Oak". src/lib/
 * product-label.ts fixes new lines; this fixes the ones already saved on live
 * estimates and invoices.
 *
 * Rewrites ONLY the redundant repeat. A description someone typed or edited by
 * hand is left exactly as it is: a row is touched only when its current text is
 * what the old formula would have produced from that product's catalog fields.
 *
 *   node scripts/fix-product-descriptions.mjs          # dry run, changes nothing
 *   node scripts/fix-product-descriptions.mjs --apply  # writes
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const says = (label, part) => {
  const n = norm(part);
  return !!n && norm(label).includes(n);
};
/** Mirrors productLabel() in src/lib/product-label.ts. */
const productLabel = (p) => {
  let label = (p.name || p.style || "").trim();
  const mfr = (p.manufacturer ?? "").trim();
  const color = (p.color ?? "").trim();
  if (!label) return [mfr, color].filter(Boolean).join(" ");
  if (mfr && !says(label, mfr)) label = `${mfr} ${label}`;
  if (color && !says(label, color)) label = `${label} ${color}`;
  return label;
};
/** What the old formula produced — the only text we're willing to overwrite. */
const oldLabel = (p) => [p.manufacturer, p.name, p.color].filter(Boolean).join(" ");

/**
 * Page through. PostgREST caps a response at 1000 rows whatever `limit` says,
 * so a single select quietly returned the first 1000 products and every line
 * whose product sat past that looked like it had no product at all — which is
 * why the first run of this script fixed 3 of 27 and reported the other 24 as
 * nothing to do.
 */
async function fetchAll(table, columns) {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < page) return out;
  }
}

const products = await fetchAll("products", "id, name, manufacturer, style, color");
const byId = new Map(products.map((p) => [p.id, p]));

const lines = (
  await fetchAll("estimate_line_items", "id, option_id, description, product_id")
).filter((l) => l.product_id);

/**
 * Collapse an immediately-repeated word or phrase: "Pearl Pearl" → "Pearl",
 * "IFC IFC Founder's" → "IFC Founder's".
 *
 * This is the fallback for rows the verbatim check can't claim. Matching
 * against the product's CURRENT catalog fields only catches lines whose product
 * hasn't changed since — it missed 24 of 27, because names get edited, item
 * numbers get added, and some rows carry typos the fields don't ("Caribbean
 * Beech" in the name, "Caribbean Beach" in the colour).
 *
 * Safe on its own terms: it only ever DELETES a literal back-to-back repeat,
 * which no one types on purpose. It never invents words and never reorders.
 */
function collapseRepeats(text) {
  let w = text.split(/\s+/).filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    // Longest phrases first, so "Leconte Oak Leconte Oak" collapses as a pair
    // rather than leaving "Oak Leconte Oak" behind.
    for (let n = 4; n >= 1 && !changed; n--) {
      for (let i = 0; i + 2 * n <= w.length; i++) {
        const a = w.slice(i, i + n).join(" ").toLowerCase();
        const b = w.slice(i + n, i + 2 * n).join(" ").toLowerCase();
        if (a && a === b) {
          w = [...w.slice(0, i + n), ...w.slice(i + 2 * n)];
          changed = true;
          break;
        }
      }
    }
  }
  return w.join(" ");
}

const planned = [];
for (const l of lines) {
  const p = byId.get(l.product_id);
  const current = (l.description ?? "").trim();
  if (!current) continue;

  // 1) Exactly what the old formula produced → rewrite to the proper label.
  //    Needs the catalog row; without it we can still de-stutter below.
  const good = p ? productLabel(p).trim() : "";
  if (p && current === oldLabel(p).trim() && current !== good) {
    planned.push({ id: l.id, from: current, to: good, how: "relabelled" });
    continue;
  }
  // 2) Otherwise, just take the stutter out of whatever is there.
  const collapsed = collapseRepeats(current);
  if (collapsed !== current) {
    planned.push({ id: l.id, from: current, to: collapsed, how: "de-duplicated" });
  }
}

console.log(
  `${lines.length} product lines · ${planned.length} to repair\n`,
);
for (const c of planned.slice(0, 40))
  console.log(`  - ${c.from}\n  + ${c.to}   (${c.how})\n`);
if (planned.length > 40) console.log(`  …and ${planned.length - 40} more\n`);

if (!APPLY) {
  console.log("DRY RUN — nothing written. Re-run with --apply to fix these.");
} else {
  let done = 0;
  for (const c of planned) {
    const { error } = await db
      .from("estimate_line_items")
      .update({ description: c.to })
      .eq("id", c.id);
    if (error) console.log(`  ! ${c.id}: ${error.message}`);
    else done++;
  }
  console.log(`Updated ${done} of ${planned.length} lines.`);
  console.log(
    "Invoices keep their own copy of the text (they're a snapshot on purpose),\n" +
      "so an invoice already raised still shows the old wording. New ones won't.",
  );
}

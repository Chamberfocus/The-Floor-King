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

const { data: products } = await db
  .from("products")
  .select("id, name, manufacturer, style, color")
  .limit(10000);
const byId = new Map((products ?? []).map((p) => [p.id, p]));

const { data: lines } = await db
  .from("estimate_line_items")
  .select("id, option_id, description, product_id")
  .not("product_id", "is", null)
  .limit(10000);

const planned = [];
for (const l of lines ?? []) {
  const p = byId.get(l.product_id);
  if (!p) continue;
  const good = productLabel(p);
  const stale = oldLabel(p);
  const current = (l.description ?? "").trim();
  // Only if it's verbatim what the old formula made, and the fix differs.
  if (current !== stale.trim() || current === good.trim()) continue;
  planned.push({ id: l.id, from: current, to: good });
}

console.log(
  `${lines?.length ?? 0} product lines · ${planned.length} written by the old formula and fixable\n`,
);
for (const c of planned.slice(0, 12)) console.log(`  - ${c.from}\n  + ${c.to}\n`);
if (planned.length > 12) console.log(`  …and ${planned.length - 12} more\n`);

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

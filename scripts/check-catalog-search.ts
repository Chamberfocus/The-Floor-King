// READ-ONLY. Runs the REAL catalog search over the live catalog for a battery
// of realistic queries and prints what comes back, so search quality is
// measured rather than guessed at.
// usage: npx tsx scripts/check-catalog-search.ts ["extra query"]
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { searchCatalogWith } from "@/lib/data/products";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const QUERIES = process.argv[2]
  ? [process.argv[2]]
  : [
      // Brand + line
      "shaw coretec",
      "coretec oak",
      "dreamweaver carpet",
      // Words that are really in the product, but reordered
      "oak white natural",
      "natural classics white oak",
      // Partial words
      "core plus",
      "acac",
      // A colour without its style
      "gold coast acacia",
      // Trade language that isn't in any product name
      "cushion",
      "8lb pad",
      "anso nylon",
      "rev wood",
      // Shapes / trims
      "quarter round",
      "t mold",
      // Misspellings — the real test of "doesn't have to be word for word"
      "dreamweever",
      "coretech",
      "acaia",
      "carpett pad",
    ];

async function main() {
  for (const q of QUERIES) {
    const t0 = Date.now();
    const rows = await searchCatalogWith(db, q, { limit: 5, activeOnly: true });
    const ms = Date.now() - t0;
    const mark = rows.length === 0 ? "  ✗ NOTHING" : "";
    console.log(`\n"${q}"  → ${rows.length} results in ${ms}ms${mark}`);
    for (const p of rows.slice(0, 4)) {
      console.log(
        `    ${String(p.manufacturer ?? "—").slice(0, 12).padEnd(13)}${String(p.name).slice(0, 46).padEnd(47)}${p.category ?? ""}`,
      );
    }
  }
}
main();

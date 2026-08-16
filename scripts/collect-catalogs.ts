// Runs the REAL collector against the live database: signs in to the supplier's
// SFTP mailbox, reads any catalog we haven't taken, and stages each as a DRAFT
// import. Changes no prices — applying is still a person's decision.
// usage: npx tsx scripts/collect-catalogs.ts
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("="); process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import { collectCatalogsOverSftp, getSupplierFeed } from "@/lib/data/supplier-feeds";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
) as unknown as Parameters<typeof getSupplierFeed>[0];

async function main() {
  const { data: suppliers } = await (db as never as ReturnType<typeof createClient>)
    .from("supplier_feeds")
    .select("supplier_id, transport, active, suppliers(name)")
    .eq("transport", "sftp");

  for (const row of (suppliers ?? []) as { supplier_id: string; active: boolean; suppliers: { name: string } | null }[]) {
    const name = row.suppliers?.name ?? "Supplier";
    const feed = await getSupplierFeed(db, row.supplier_id);
    if (!feed) continue;
    console.log(`${name} — ${feed.sftp_username}@${feed.sftp_host}:${feed.sftp_port} ${feed.sftp_remote_path ?? "(home)"}`);

    const run = await collectCatalogsOverSftp(db, feed, name);
    if (run.error) {
      console.log(`  FAILED: ${run.error}`);
      continue;
    }
    console.log(`  files in mailbox: ${run.filesSeen}`);
    for (const w of run.warnings) console.log(`  ! ${w}`);
    if (!run.imports.length) {
      console.log("  nothing new to import");
      continue;
    }
    for (const imp of run.imports) {
      console.log(`  ${imp.fileName}: ${imp.matched} product lines, ${imp.changed} would change`);
      console.log(`     review at /settings/suppliers/${row.supplier_id}/imports/${imp.importId}`);
    }
  }
}
main();

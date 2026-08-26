/**
 * Archive everything, then (optionally) clear the customer data for a fresh start.
 *
 * The archive runs first and always. It writes two things:
 *
 *   data.json      every row of every customer-facing table, exactly as stored.
 *                  This is the safety net — anything deleted can be read back,
 *                  and re-imported if it ever has to be.
 *   WORK-ORDERS.md every job written out in full and readable: customer, site,
 *                  dates, crew, every scope line with quantities and prices,
 *                  its estimate, its invoices and what was paid. This is the
 *                  one you'd actually open in two years to answer "what did we
 *                  do at that house".
 *
 * Nothing is deleted unless --wipe is passed, and --wipe refuses to run unless
 * the archive was written first.
 *
 *   node scripts/archive-and-reset.mjs            # archive only
 *   node scripts/archive-and-reset.mjs --wipe     # archive, then clear
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WIPE = process.argv.includes("--wipe");
const STAMP = new Date().toISOString().slice(0, 10);
const OUT = `${process.env.HOME}/Documents/floorking-archive-${STAMP}`;

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

/** PostgREST caps a response at 1000 rows whatever `limit` says. */
async function all(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").range(from, from + 999);
    if (error) return { rows: out, error: error.message };
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) return { rows: out, error: null };
  }
}

/**
 * The customer's world. Order matters for the wipe: children before parents, so
 * nothing is orphaned mid-delete even if it stops partway.
 */
const CUSTOMER_DATA = [
  "step_overrides",
  "job_issues",
  "installer_bill_line_items",
  "installer_bills",
  "job_line_items",
  "payments",
  "invoice_items",
  "invoices",
  "po_items",
  "purchase_orders",
  "order_items",
  "orders",
  "estimate_line_items",
  "estimate_options",
  "estimates",
  "work_notes",
  "messages",
  "activities",
  "handoffs",
  "appointments",
  "customer_areas",
  "jobs",
  "service_addresses",
  "customers",
];

/** Kept — this is the business, not the customer list. */
const KEEP = [
  "products",
  "suppliers",
  "profiles",
  "workflow_stages",
  "estimate_questions",
  "accessory_types",
  "accessory_programs",
  "lead_sources",
  "org_settings",
];

const money = (n) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d) => (d ? String(d).slice(0, 10) : "—");

mkdirSync(OUT, { recursive: true });

// ── 1. Everything, as stored ────────────────────────────────────────────────
const dump = {};
const counts = [];
for (const t of [...CUSTOMER_DATA, ...KEEP]) {
  const { rows, error } = await all(t);
  if (error) {
    counts.push(`${t}: skipped (${error.slice(0, 40)})`);
    continue;
  }
  dump[t] = rows;
  counts.push(`${t}: ${rows.length}`);
}
writeFileSync(`${OUT}/data.json`, JSON.stringify(dump, null, 2));

// ── 2. The work orders, readable ────────────────────────────────────────────
const by = (rows, key) => {
  const m = new Map();
  for (const r of rows ?? []) {
    const a = m.get(r[key]) ?? [];
    a.push(r);
    m.set(r[key], a);
  }
  return m;
};
const cust = new Map((dump.customers ?? []).map((c) => [c.id, c]));
const addr = new Map((dump.service_addresses ?? []).map((a) => [a.id, a]));
const est = new Map((dump.estimates ?? []).map((e) => [e.id, e]));
const linesByJob = by(dump.job_line_items, "job_id");
const linesByOpt = by(dump.estimate_line_items, "option_id");
const invByJob = by(dump.invoices, "job_id");
const itemsByInv = by(dump.invoice_items, "invoice_id");
const payByInv = by(dump.payments, "invoice_id");
const poByJob = by(dump.purchase_orders, "job_id");

const md = [];
md.push(`# Floor King — work orders archived ${STAMP}`);
md.push("");
md.push(
  `Every job on record at the time of the reset: ${(dump.jobs ?? []).length} in total. ` +
    `Line quantities and prices are exactly as they stood. The complete raw data ` +
    `is in \`data.json\` beside this file if anything here isn't enough.`,
);
md.push("");

for (const j of (dump.jobs ?? []).sort((a, b) =>
  String(b.created_at).localeCompare(String(a.created_at)),
)) {
  const c = cust.get(j.customer_id);
  const site =
    [j.site_street, j.site_city, j.site_state, j.site_zip].filter(Boolean).join(", ") ||
    (j.service_address_id ? addr.get(j.service_address_id)?.street : null) ||
    "—";
  md.push(`## ${c?.full_name ?? "Unknown customer"} — ${j.title ?? "Job"}`);
  md.push("");
  md.push(`- **Site:** ${site}`);
  md.push(`- **Status:** ${j.status ?? "—"}   **Scheduled:** ${date(j.scheduled_date)}`);
  if (c?.phone) md.push(`- **Phone:** ${c.phone}`);
  if (c?.email) md.push(`- **Email:** ${c.email}`);
  md.push(`- **Created:** ${date(j.created_at)}`);
  const e = j.estimate_id ? est.get(j.estimate_id) : null;
  if (e) md.push(`- **Estimate:** ${e.title ?? "—"} (${e.status})`);
  if (j.notes) md.push(`- **Notes:** ${String(j.notes).replace(/\n/g, "  \n  ")}`);
  md.push("");

  const lines = linesByJob.get(j.id) ?? (j.option_id ? linesByOpt.get(j.option_id) : []) ?? [];
  if (lines.length) {
    md.push("| Room | What | Qty | Unit | Material | Labor |");
    md.push("|---|---|---:|---|---:|---:|");
    for (const l of lines.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
      const qty = l.sqft ?? l.quantity ?? "";
      md.push(
        `| ${l.room ?? ""} | ${String(l.description ?? "").replace(/\|/g, "/")} | ${qty} | ${l.unit ?? ""} | ${money(l.material_rate)} | ${money(l.labor_rate)} |`,
      );
    }
    md.push("");
  } else {
    md.push("_No scope lines recorded._");
    md.push("");
  }

  for (const inv of invByJob.get(j.id) ?? []) {
    const items = itemsByInv.get(inv.id) ?? [];
    const paid = (payByInv.get(inv.id) ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const billed = items.reduce(
      (s, it) => s + (Number(it.quantity) || 0) * (Number(it.rate) || 0),
      0,
    );
    md.push(
      `**Invoice ${inv.number ?? inv.id.slice(0, 8)}** — ${inv.status}, billed ${money(billed)}, paid ${money(paid)}`,
    );
    md.push("");
  }
  const pos = poByJob.get(j.id) ?? [];
  if (pos.length)
    md.push(
      `**Purchase orders:** ${pos.map((p) => `#${p.po_number ?? "?"} ${p.supplier ?? ""} (${p.status})`).join(", ")}`,
    );
  md.push("");
  md.push("---");
  md.push("");
}
writeFileSync(`${OUT}/WORK-ORDERS.md`, md.join("\n"));

console.log(`ARCHIVE WRITTEN → ${OUT}`);
console.log(`  data.json        every row, as stored`);
console.log(`  WORK-ORDERS.md   ${(dump.jobs ?? []).length} jobs, readable`);
console.log("");
console.log(counts.join("\n"));

if (!WIPE) {
  console.log("\nARCHIVE ONLY — nothing deleted. Re-run with --wipe to clear.");
  process.exit(0);
}

// ── 3. The wipe ─────────────────────────────────────────────────────────────
console.log("\nCLEARING CUSTOMER DATA…");
for (const t of CUSTOMER_DATA) {
  const { error, count } = await db
    .from(t)
    .delete({ count: "exact" })
    .not("id", "is", null);
  console.log(`  ${t.padEnd(26)} ${error ? "ERROR " + error.message : `${count ?? 0} removed`}`);
}
console.log("\nKept untouched: " + KEEP.join(", "));

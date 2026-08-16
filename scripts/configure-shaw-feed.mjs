// Configure Shaw's price feed from the details in their B2B enrollment email.
// Mirrors the validation the connect page applies — no secret is written; the
// password lives only in the env var named by credential_key.
// Idempotent: re-running just re-asserts the same settings.
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

const { data: supplier } = await db
  .from("suppliers")
  .select("id, name, account_number")
  .ilike("name", "%shaw%")
  .maybeSingle();
if (!supplier) {
  console.log("No Shaw supplier record found.");
  process.exit(1);
}

const settings = {
  supplier_id: supplier.id,
  kind: "fcb2b_832",
  transport: "sftp",
  sftp_host: "shawedi.shawfloors.com",
  sftp_port: 22,
  sftp_username: "edi07639",
  sftp_remote_path: null, // login's home directory until we see the listing
  credential_key: "SHAW_SFTP_PASSWORD",
  // From their Web Services block. Recorded, though those services are not
  // provisioned (EdiId and SecretId came through blank).
  client_identifier: "Custom",
  endpoint_url: null,
  price_service_path: null,
  cadence_days: 1, // they write a file whenever an agreement price changes
  active: true,
  notes:
    "832 over SFTP. Shaw generates a file whenever a price on the agreement changes. " +
    "Price = the agreement price set by our Shaw rep (our cost, not list). " +
    "SKU on the file = the selling style, same as on their invoices and our POs. " +
    "Carpet is priced per square yard with roll width and standard length included. " +
    "Support: shaw.b2b@shawinc.com / 1-888-742-9932 opt 6.",
  updated_at: new Date().toISOString(),
};

const { data: existing } = await db
  .from("supplier_feeds")
  .select("id")
  .eq("supplier_id", supplier.id)
  .maybeSingle();

const { error } = existing
  ? await db.from("supplier_feeds").update(settings).eq("id", existing.id)
  : await db.from("supplier_feeds").insert(settings);

if (error) {
  console.log("FAILED:", error.message);
  process.exit(1);
}

// Their account number belongs on the vendor record, not buried in a feed note.
if (!supplier.account_number) {
  await db.from("suppliers").update({ account_number: "226334" }).eq("id", supplier.id);
  console.log("Set account number 226334 on the vendor record.");
}

const { data: saved } = await db
  .from("supplier_feeds")
  .select("kind, transport, sftp_host, sftp_port, sftp_username, sftp_remote_path, credential_key, cadence_days, active")
  .eq("supplier_id", supplier.id)
  .maybeSingle();

console.log(`${supplier.name} feed configured:`);
for (const [k, v] of Object.entries(saved ?? {})) {
  console.log(`  ${k.padEnd(18)} ${v === null ? "(home directory)" : v}`);
}
const pw = process.env[saved?.credential_key ?? ""];
console.log(
  `\nPassword variable ${saved?.credential_key}: ${pw ? "present locally" : "NOT SET (add it in Vercel, and locally to test from here)"}`,
);

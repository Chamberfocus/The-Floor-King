// READ-ONLY against the supplier. Downloads one 832 to a local path and
// reports its SHAPE — segment tags, separators, and a couple of whole items —
// so the parser can be checked against what the mill actually sends.
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import SftpClient from "ssh2-sftp-client";

const remote = process.argv[2];
const out = process.argv[3];
if (!remote || !out) {
  console.log("usage: node scripts/fetch-832-sample.mjs <remote path> <local path>");
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: feed } = await db
  .from("supplier_feeds")
  .select("sftp_host, sftp_port, sftp_username, credential_key")
  .eq("transport", "sftp")
  .limit(1)
  .maybeSingle();

const sftp = new SftpClient();
await sftp.connect({
  host: feed.sftp_host,
  port: feed.sftp_port ?? 22,
  username: feed.sftp_username,
  password: process.env[feed.credential_key],
  readyTimeout: 25_000,
});
const buf = await sftp.get(remote);
await sftp.end();

const text = buf.toString("utf8");
writeFileSync(out, text);
console.log(`${text.length} bytes → ${out}\n`);

// Separators, read the way the parser reads them.
const elementSep = text.startsWith("ISA") ? text[3] : "*";
const componentSep = text.startsWith("ISA") && text.length > 105 ? text[104] : ">";
const segmentSep = text.startsWith("ISA") && text.length > 105 ? text[105] : "~";
const show = (c) => (c === "\n" ? "\\n" : c === "\r" ? "\\r" : c);
console.log(`separators: element='${show(elementSep)}' component='${show(componentSep)}' segment='${show(segmentSep)}'`);

const segments = text.split(segmentSep).map((s) => s.trim().replace(/\n/g, "")).filter(Boolean);
console.log(`segments: ${segments.length}\n`);

const tally = new Map();
for (const s of segments) {
  const tag = s.split(elementSep)[0];
  tally.set(tag, (tally.get(tag) ?? 0) + 1);
}
console.log("segment tags:");
for (const [tag, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tag.padEnd(6)} ${n}`);
}

// The header, then the first two complete items.
console.log("\n--- header ---");
for (const s of segments.slice(0, 8)) console.log("  " + s);

const linIdx = segments.map((s, i) => [s, i]).filter(([s]) => s.startsWith(`LIN${elementSep}`)).map(([, i]) => i);
console.log(`\n--- first 2 items (of ${linIdx.length} LIN segments) ---`);
for (const start of linIdx.slice(0, 2)) {
  const end = segments.findIndex((s, i) => i > start && s.startsWith(`LIN${elementSep}`));
  for (const s of segments.slice(start, end === -1 ? start + 12 : Math.min(end, start + 14))) {
    console.log("  " + s);
  }
  console.log("");
}

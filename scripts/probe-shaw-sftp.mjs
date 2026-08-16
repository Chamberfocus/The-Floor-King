// READ-ONLY. Signs in to a supplier's SFTP mailbox and lists what's there, so
// we learn the directory and file naming before wiring the collector to it.
// Reads the password from the env var named on the feed. Never prints it.
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";
import SftpClient from "ssh2-sftp-client";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: feed } = await db
  .from("supplier_feeds")
  .select("sftp_host, sftp_port, sftp_username, sftp_remote_path, credential_key, suppliers(name)")
  .eq("transport", "sftp")
  .limit(1)
  .maybeSingle();

if (!feed) {
  console.log("No SFTP feed configured.");
  process.exit(1);
}

const password = process.env[feed.credential_key];
if (!password) {
  console.log(`${feed.credential_key} is not set locally — add it to .env.local to test from here.`);
  process.exit(1);
}

const sftp = new SftpClient();
const dirsToTry = [feed.sftp_remote_path?.trim() || ".", "/", "/outbox", "/out", "/832", "/pricing"];

try {
  console.log(`Connecting to ${feed.sftp_username}@${feed.sftp_host}:${feed.sftp_port ?? 22} …`);
  await sftp.connect({
    host: feed.sftp_host,
    port: feed.sftp_port ?? 22,
    username: feed.sftp_username,
    password,
    readyTimeout: 25_000,
  });
  console.log("Signed in.\n");

  const seen = new Set();
  for (const dir of dirsToTry) {
    try {
      const listing = await sftp.list(dir);
      const key = JSON.stringify(listing.map((f) => f.name).sort());
      if (seen.has(key)) continue; // same directory reached by another name
      seen.add(key);
      const files = listing.filter((f) => f.type === "-");
      const subdirs = listing.filter((f) => f.type === "d");
      console.log(`${dir}  —  ${files.length} file(s), ${subdirs.length} folder(s)`);
      for (const d of subdirs.slice(0, 15)) console.log(`    [dir]  ${d.name}`);
      for (const f of files.slice(0, 25)) {
        const when = f.modifyTime ? new Date(f.modifyTime).toISOString().slice(0, 16).replace("T", " ") : "?";
        console.log(`    ${String(f.size).padStart(9)}  ${when}  ${f.name}`);
      }
      if (files.length > 25) console.log(`    … and ${files.length - 25} more`);
      console.log("");
    } catch {
      /* directory doesn't exist — that is itself an answer */
    }
  }
} catch (e) {
  console.log("FAILED:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  try {
    await sftp.end();
  } catch {
    /* already closed */
  }
}

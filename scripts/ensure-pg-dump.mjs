#!/usr/bin/env node
/**
 * Downloads a pinned static linux-amd64 pg_dump for Vercel.
 * Does not print secrets. Verifies SHA-256 before writing.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const URL =
  "https://github.com/whoisnian/static-binaries/releases/download/v20260301.0/pg_dump_v20260301.0_linux_amd64";
const SHA256 = "1e9eb15e09a0197b4c3547e6a0e44b2fed0ff22bf2b9747e07d55fdcf92302f4";
const DEST = join(ROOT, "vendor/pg_dump/linux-amd64/pg_dump");

async function main() {
  try {
    const existing = await readFile(DEST);
    const got = createHash("sha256").update(existing).digest("hex");
    if (got === SHA256) {
      console.log("pg_dump vendor binary already present");
      return;
    }
  } catch {
    /* download */
  }
  const res = await fetch(URL);
  if (!res.ok) {
    console.warn(`pg_dump download skipped (${res.status}). Runtime will retry on linux.`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== SHA256) {
    throw new Error("pg_dump hash mismatch");
  }
  await mkdir(dirname(DEST), { recursive: true });
  await writeFile(DEST, buf, { mode: 0o755 });
  await chmod(DEST, 0o755);
  console.log("pg_dump vendor binary installed");
}

main().catch((err) => {
  console.warn(String(err instanceof Error ? err.message : err));
  // Do not fail local/CI typecheck hosts that cannot fetch; Vercel linux runtime can download.
  process.exit(0);
});

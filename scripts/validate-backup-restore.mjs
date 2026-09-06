#!/usr/bin/env node
/**
 * Non-production restore validation against local files.
 * Usage: node scripts/validate-backup-restore.mjs --dump file --checksums file --inventory file
 * Never connects to production.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const dumpPath = arg("--dump");
const checksumsPath = arg("--checksums");
const inventoryPath = arg("--inventory");
if (!dumpPath || !checksumsPath || !inventoryPath) {
  console.error("usage: node scripts/validate-backup-restore.mjs --dump FILE --checksums FILE --inventory FILE");
  process.exit(2);
}

const dump = readFileSync(dumpPath);
const checksums = readFileSync(checksumsPath, "utf8");
const inventory = readFileSync(inventoryPath, "utf8");

let sql = dump;
if (dump[0] === 0x1f && dump[1] === 0x8b) sql = gunzipSync(dump);
const text = sql.toString("utf8");
if (!text.includes("-- PostgreSQL database dump")) {
  console.error("FAIL DUMP_HEADER_MISSING");
  process.exit(1);
}
if (!text.includes("-- PostgreSQL database dump complete")) {
  console.error("FAIL DUMP_INCOMPLETE");
  process.exit(1);
}
if (!/CREATE TABLE/i.test(text)) {
  console.error("FAIL DUMP_NO_SCHEMA");
  process.exit(1);
}

const dumpLine = checksums
  .split(/\n/)
  .map((l) => l.trim())
  .find((l) => l.includes("public.sql"));
if (!dumpLine) {
  console.error("FAIL CHECKSUM_DUMP_MISSING");
  process.exit(1);
}
const hex = dumpLine.split(/\s+/)[0];
if (hex !== sha256(dump)) {
  console.error("FAIL CHECKSUM_MISMATCH");
  process.exit(1);
}

const objects = inventory.split(/\n/).filter((l) => l.trim());
console.log(
  JSON.stringify({
    ok: true,
    dumpBytes: dump.length,
    dumpSha256: sha256(dump),
    objectCount: objects.length,
    productionMutated: false,
  }),
);

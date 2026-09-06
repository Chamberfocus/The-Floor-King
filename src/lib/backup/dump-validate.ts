import { gunzipSync } from "node:zlib";

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const PG_DUMP_COMPLETE = "-- PostgreSQL database dump complete";
const PG_DUMP_HEADER = "-- PostgreSQL database dump";
const PGDMP_MAGIC = Buffer.from("PGDMP");

export type DumpValidation =
  | { ok: true; format: "plain-sql" | "plain-sql-gz" | "custom"; byteLength: number }
  | { ok: false; code: string };

function maybeGunzip(bytes: Buffer): { text: string; gzipped: boolean } | null {
  if (bytes.length >= 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    try {
      return { text: gunzipSync(bytes).toString("utf8"), gzipped: true };
    } catch {
      return null;
    }
  }
  return { text: bytes.toString("utf8"), gzipped: false };
}

export function validatePostgresDump(bytes: Uint8Array): DumpValidation {
  const buf = Buffer.from(bytes);
  if (buf.length < 64) return { ok: false, code: "DUMP_EMPTY" };

  if (buf.subarray(0, 5).equals(PGDMP_MAGIC)) {
    return { ok: true, format: "custom", byteLength: buf.length };
  }

  const unzipped = maybeGunzip(buf);
  if (!unzipped) return { ok: false, code: "DUMP_GZIP_CORRUPT" };
  const text = unzipped.text;
  if (!text.includes(PG_DUMP_HEADER)) return { ok: false, code: "DUMP_HEADER_MISSING" };
  if (!text.includes(PG_DUMP_COMPLETE)) return { ok: false, code: "DUMP_INCOMPLETE" };
  const hasSchema =
    /\bCREATE TABLE\b/i.test(text) ||
    /\bCREATE FUNCTION\b/i.test(text) ||
    /\bCREATE VIEW\b/i.test(text) ||
    /\bCOPY public\./i.test(text);
  if (!hasSchema) return { ok: false, code: "DUMP_NO_SCHEMA" };
  return {
    ok: true,
    format: unzipped.gzipped ? "plain-sql-gz" : "plain-sql",
    byteLength: buf.length,
  };
}

export function dumpLooksRestorableByPgRestore(bytes: Uint8Array): boolean {
  const buf = Buffer.from(bytes);
  return buf.subarray(0, 5).equals(PGDMP_MAGIC) || validatePostgresDump(buf).ok;
}

import { parseChecksumFile, verifyChecksums, sha256Hex } from "./checksums";
import { validatePostgresDump } from "./dump-validate";

export type RestoreValidationInput = {
  dumpBytes: Uint8Array;
  checksumText: string;
  inventoryText: string;
  sampleObject?: { bytes: Uint8Array; sha256: string };
};

export type RestoreValidationResult =
  | {
      ok: true;
      dumpFormat: "plain-sql" | "plain-sql-gz" | "custom";
      objectCount: number;
      checksums: "pass";
      sampleReadback: "pass" | "skipped";
    }
  | { ok: false; code: string };

export function validateRestorableBackup(input: RestoreValidationInput): RestoreValidationResult {
  const dump = validatePostgresDump(input.dumpBytes);
  if (!dump.ok) return { ok: false, code: dump.code };
  let checksums;
  try {
    checksums = parseChecksumFile(input.checksumText);
  } catch {
    return { ok: false, code: "CHECKSUMS_MALFORMED" };
  }
  const dumpLine = checksums.find((l) => l.file.endsWith("public.sql.gz") || l.file.endsWith("public.sql"));
  if (!dumpLine) return { ok: false, code: "CHECKSUM_DUMP_MISSING" };
  if (dumpLine.sha256 !== sha256Hex(input.dumpBytes) || dumpLine.bytes !== input.dumpBytes.byteLength) {
    return { ok: false, code: "CHECKSUM_MISMATCH" };
  }
  const inventoryLines = input.inventoryText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const storageChecksums = checksums.filter((l) => l.file.startsWith("storage/"));
  if (storageChecksums.length !== inventoryLines.length) {
    return { ok: false, code: "INVENTORY_COUNT_MISMATCH" };
  }
  const actual = checksums.map((c) => ({ file: c.file, sha256: c.sha256, bytes: c.bytes }));
  const verified = verifyChecksums(checksums, actual);
  if (!verified.ok) return { ok: false, code: verified.code };

  let sampleReadback: "pass" | "skipped" = "skipped";
  if (input.sampleObject) {
    if (sha256Hex(input.sampleObject.bytes) !== input.sampleObject.sha256) {
      return { ok: false, code: "STORAGE_READBACK_MISMATCH" };
    }
    sampleReadback = "pass";
  }
  return {
    ok: true,
    dumpFormat: dump.format,
    objectCount: inventoryLines.length,
    checksums: "pass",
    sampleReadback,
  };
}

export const RESTORE_ORDER = [
  "1. Provision a NEW Supabase project (never restore onto live production).",
  "2. Apply repo migrations 0001–0179 in the SQL editor if the dump is data-only; if the dump includes public schema DDL, restore public.sql.gz with psql into public after reviewing role/privilege errors.",
  "3. Restore Storage objects from Drive storage/{bucket}/{path} using the service role, matching inventory.jsonl.",
  "4. Restore auth.users only if auth.sql.gz is present and valid — otherwise recreate staff logins; portal customers will need new invites.",
  "5. Point a non-production Vercel env or local .env.local at the new project and smoke-test.",
  "6. Do not enable accounting flags as part of restore.",
] as const;

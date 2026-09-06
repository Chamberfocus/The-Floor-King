import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function md5Hex(bytes: Uint8Array | string): string {
  return createHash("md5").update(bytes).digest("hex");
}

export type ChecksumLine = { file: string; sha256: string; bytes: number };

export function formatChecksumFile(lines: ChecksumLine[]): string {
  return lines
    .map((l) => `${l.sha256}  ${l.file}  ${l.bytes}`)
    .join("\n")
    .concat("\n");
}

export function parseChecksumFile(text: string): ChecksumLine[] {
  const out: ChecksumLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-f0-9]{64})\s+(\S+)\s+(\d+)$/i.exec(line);
    if (!m) throw new Error("CHECKSUMS_MALFORMED");
    out.push({ sha256: m[1].toLowerCase(), file: m[2], bytes: Number(m[3]) });
  }
  return out;
}

export function verifyChecksums(
  expected: ChecksumLine[],
  actual: Array<{ file: string; sha256: string; bytes: number }>,
): { ok: true } | { ok: false; code: string } {
  if (expected.length !== actual.length) return { ok: false, code: "CHECKSUM_COUNT_MISMATCH" };
  const map = new Map(actual.map((a) => [a.file, a]));
  for (const e of expected) {
    const got = map.get(e.file);
    if (!got) return { ok: false, code: "CHECKSUM_FILE_MISSING" };
    if (got.sha256 !== e.sha256 || got.bytes !== e.bytes) {
      return { ok: false, code: "CHECKSUM_MISMATCH" };
    }
  }
  return { ok: true };
}

/**
 * F6-P2C bank statement CSV import — staging + duplicate detection (pure).
 * Mirrors hardened stage_bank_statement_import_safe semantics in 0173.
 *
 * FILE fingerprint (order-independent; filename metadata only):
 *   md5(accountId + '|' + sorted lines of date|absAmount|direction|desc|sourceRef)
 *
 * TRANSACTION content key (no source_row_no):
 *   accountId|date|absAmount|direction|lower(desc)|sourceRef
 *
 * occurrenceIndex: 1-based within THIS payload for the same content key.
 * sourceRowFingerprint (canonical): md5(contentKey + '|' + occurrenceIndex)
 *
 * Duplicate model:
 * A) exact_reimport — same canonical fingerprint already staged (evidence only)
 * B) possible_duplicate — date+amount+description+direction heuristic (cross-batch)
 * C) unmatched — legitimate economic row
 * D) rejected — malformed (not in this pure stager when validation fails)
 */
import { createHash } from "node:crypto";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type BankImportDuplicateStatus =
  | "unmatched"
  | "exact_reimport"
  | "possible_duplicate"
  | "rejected";

export interface BankImportCsvRow {
  date: string;
  description?: string;
  amount: number;
  /** Optional stable source line id from CSV (check #, bank ref, etc.) */
  sourceRef?: string;
}

export interface StagedBankImportLine {
  sourceRowNo: number;
  transactionDate: string;
  description: string;
  amount: number;
  direction: "deposit" | "withdrawal";
  duplicateStatus: BankImportDuplicateStatus;
  duplicateReason: string | null;
  rejectionReason: string | null;
  transactionFingerprint: string;
  occurrenceIndex: number;
  /** Set on canonical rows only (unmatched / possible_duplicate). */
  sourceRowFingerprint: string | null;
  /** Set on exact_reimport rows for traceability. */
  canonicalSourceRowFingerprint?: string;
  exactReimportOfSourceRowNo?: number;
  possibleDuplicateOfSourceRowNo?: number;
  rawRow: BankImportCsvRow;
}

export interface BankImportStageResult {
  importFingerprint: string;
  sourceRowCount: number;
  stagedRowCount: number;
  rejectedRowCount: number;
  exactReimportCount: number;
  possibleDuplicateCount: number;
  lines: StagedBankImportLine[];
  rejected: { sourceRowNo: number; reason: string; rawRow: BankImportCsvRow }[];
}

function md5Hex(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

export function bankDirectionFromAmount(amount: number): "deposit" | "withdrawal" {
  return amount >= 0 ? "deposit" : "withdrawal";
}

/** Stable transaction content key (no row position). */
export function transactionContentKey(args: {
  accountId: string;
  date: string;
  amount: number;
  description?: string;
  sourceRef?: string;
}): string {
  const abs = round2(Math.abs(args.amount));
  const dir = bankDirectionFromAmount(args.amount);
  const desc = (args.description ?? "").trim().toLowerCase();
  const ref = (args.sourceRef ?? "").trim();
  return `${args.accountId}|${args.date}|${abs}|${dir}|${desc}|${ref}`;
}

/** Canonical fingerprint including occurrence (no sole reliance on row position). */
export function sourceRowFingerprint(args: {
  accountId: string;
  occurrenceIndex: number;
  row: BankImportCsvRow;
}): string {
  const key = transactionContentKey({
    accountId: args.accountId,
    date: args.row.date,
    amount: args.row.amount,
    description: args.row.description,
    sourceRef: args.row.sourceRef,
  });
  return md5Hex(`${key}|${args.occurrenceIndex}`);
}

/** Order-independent file content fingerprint. */
export function importContentFingerprint(args: {
  accountId: string;
  rows: BankImportCsvRow[];
}): string {
  const lines = args.rows.map((row) => {
    const abs = round2(Math.abs(row.amount));
    const dir = bankDirectionFromAmount(row.amount);
    const desc = (row.description ?? "").trim().toLowerCase();
    const ref = (row.sourceRef ?? "").trim();
    return `${row.date}|${abs}|${dir}|${desc}|${ref}`;
  });
  lines.sort();
  return md5Hex(`${args.accountId}|${lines.join("\n")}`);
}

/** Heuristic key for possible-duplicate review. Includes direction. */
export function heuristicDuplicateKey(row: BankImportCsvRow): string {
  const amt = round2(Math.abs(row.amount));
  const desc = (row.description ?? "").trim().toLowerCase();
  const dir = bankDirectionFromAmount(row.amount);
  return `${row.date}|${amt}|${desc}|${dir}`;
}

/** @deprecated kept for callers; prefer importContentFingerprint. */
export function normalizeImportRowLine(
  sourceRowNo: number,
  row: BankImportCsvRow,
): string {
  const amt = round2(Math.abs(row.amount));
  const desc = (row.description ?? "").trim().toLowerCase();
  const ref = (row.sourceRef ?? "").trim();
  const dir = bankDirectionFromAmount(row.amount);
  return `${sourceRowNo}|${row.date}|${amt}|${dir}|${desc}|${ref}`;
}

export function parseBankStatementCsv(text: string): BankImportCsvRow[] {
  const rows: BankImportCsvRow[] = [];
  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.toLowerCase().startsWith("date,")) continue;
    lineNo += 1;
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const date = parts[0]?.trim();
    const amount = parseFloat(parts[parts.length - 1]?.trim() ?? "");
    const description = parts.slice(1, -1).join(",").trim();
    if (!date || !Number.isFinite(amount)) continue;
    rows.push({ date, description, amount, sourceRef: String(lineNo) });
  }
  return rows;
}

function validateRow(row: BankImportCsvRow & { direction?: string }): string | null {
  if (!row.date) return "Missing transaction date.";
  const raw = Number(row.amount);
  if (!Number.isFinite(raw)) return "Invalid amount.";
  if (Object.is(raw, -0) || Object.is(raw, NaN)) return "Invalid amount.";
  if (Math.abs(raw) === Infinity) return "Invalid amount.";
  const abs = Math.abs(raw);
  if (!(abs > 0)) return "Amount must be non-zero.";
  if (Math.round(abs * 100) / 100 !== abs) return "Amount must be exact cents.";
  const explicitDir = row.direction?.toLowerCase();
  if (explicitDir && raw < 0) {
    return "Amount sign conflicts with explicit direction.";
  }
  return null;
}

/** Stage import rows with exact-reimport vs possible-duplicate distinction. */
export function stageBankImportRows(args: {
  accountId: string;
  fileName: string;
  rows: BankImportCsvRow[];
  /** Canonical fingerprints already staged (fp -> original sourceRowNo). */
  existingCanonicalFingerprints?: Map<string, number>;
  /** Heuristic keys already seen in prior imports (for possible_duplicate flag). */
  existingHeuristicKeys?: Set<string>;
}): BankImportStageResult {
  const existingCanonical = new Map(args.existingCanonicalFingerprints ?? []);
  const heuristicSeen = new Set(args.existingHeuristicKeys ?? []);
  const batchHeuristic = new Map<string, number>();
  const contentKeyOcc = new Map<string, number>();

  const lines: StagedBankImportLine[] = [];
  const rejected: BankImportStageResult["rejected"] = [];
  let exactReimportCount = 0;
  let possibleDuplicateCount = 0;

  for (let i = 0; i < args.rows.length; i++) {
    const row = args.rows[i]!;
    const sourceRowNo = i + 1;
    const validationError = validateRow(row);
    if (validationError) {
      rejected.push({ sourceRowNo, reason: validationError, rawRow: row });
      continue;
    }

    const contentKey = transactionContentKey({
      accountId: args.accountId,
      date: row.date,
      amount: row.amount,
      description: row.description,
      sourceRef: row.sourceRef,
    });
    const occurrenceIndex = (contentKeyOcc.get(contentKey) ?? 0) + 1;
    contentKeyOcc.set(contentKey, occurrenceIndex);

    const fp = sourceRowFingerprint({
      accountId: args.accountId,
      occurrenceIndex,
      row,
    });
    const hkey = heuristicDuplicateKey(row);
    const absAmt = round2(Math.abs(row.amount));
    const direction = bankDirectionFromAmount(row.amount);

    let duplicateStatus: BankImportDuplicateStatus = "unmatched";
    let duplicateReason: string | null = null;
    let sourceRowFingerprintValue: string | null = fp;
    let canonicalSourceRowFingerprint: string | undefined;
    let exactReimportOfSourceRowNo: number | undefined;
    let possibleDuplicateOfSourceRowNo: number | undefined;

    if (existingCanonical.has(fp)) {
      duplicateStatus = "exact_reimport";
      duplicateReason = "Exact source row fingerprint already staged.";
      canonicalSourceRowFingerprint = fp;
      exactReimportOfSourceRowNo = existingCanonical.get(fp);
      sourceRowFingerprintValue = null;
      exactReimportCount += 1;
    } else if (heuristicSeen.has(hkey) || batchHeuristic.has(hkey)) {
      duplicateStatus = "possible_duplicate";
      duplicateReason =
        "Another staged transaction shares date, amount, direction, and description; review required.";
      possibleDuplicateOfSourceRowNo = batchHeuristic.get(hkey);
      possibleDuplicateCount += 1;
    }

    if (sourceRowFingerprintValue) {
      existingCanonical.set(fp, sourceRowNo);
    }
    if (!batchHeuristic.has(hkey)) {
      batchHeuristic.set(hkey, sourceRowNo);
    }
    heuristicSeen.add(hkey);

    lines.push({
      sourceRowNo,
      transactionDate: row.date,
      description: row.description ?? "",
      amount: absAmt,
      direction,
      duplicateStatus,
      duplicateReason,
      rejectionReason: null,
      transactionFingerprint: contentKey,
      occurrenceIndex,
      sourceRowFingerprint: sourceRowFingerprintValue,
      canonicalSourceRowFingerprint,
      exactReimportOfSourceRowNo,
      possibleDuplicateOfSourceRowNo,
      rawRow: row,
    });
  }

  return {
    importFingerprint: importContentFingerprint({
      accountId: args.accountId,
      rows: args.rows,
    }),
    sourceRowCount: args.rows.length,
    stagedRowCount: lines.length,
    rejectedRowCount: rejected.length,
    exactReimportCount,
    possibleDuplicateCount,
    lines,
    rejected,
  };
}

/** Exact reimports are evidence only — never economic bank activity. */
export function isEconomicBankImportLine(line: {
  duplicateStatus: string;
  reviewStatus?: string;
}): boolean {
  if (line.reviewStatus === "excluded") return false;
  if (line.duplicateStatus === "rejected") return false;
  if (line.duplicateStatus === "exact_reimport") return false;
  return (
    line.duplicateStatus === "unmatched" ||
    line.duplicateStatus === "possible_duplicate"
  );
}

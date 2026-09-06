/**
 * F6-P1 opening balance readiness (preview only — no production entry).
 */
import { assessJournalBalance } from "@/lib/accounting/journal";
import { buildOpeningBalanceJournal } from "@/lib/accounting/builders";
import type { AccountMappingDict } from "@/lib/accounting/types";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface OpeningBalanceLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface OpeningBalancePreview {
  entryDate: string;
  lines: OpeningBalanceLineInput[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
  idempotencyKey: string;
  ready: boolean;
  errors: string[];
}

export function previewOpeningBalances(args: {
  entryDate: string;
  lines: OpeningBalanceLineInput[];
  mappings: AccountMappingDict;
  openingId?: string;
}): OpeningBalancePreview {
  const errors: string[] = [];
  if (!args.entryDate) errors.push("Opening balance effective date is required.");
  if (!args.lines.length) errors.push("At least one opening balance line is required.");

  let built;
  try {
    built = buildOpeningBalanceJournal({
      entryDate: args.entryDate,
      lines: args.lines,
      mappings: args.mappings,
      openingId: args.openingId,
    });
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Invalid opening balance journal.");
    return {
      entryDate: args.entryDate,
      lines: args.lines,
      totalDebits: 0,
      totalCredits: 0,
      balanced: false,
      idempotencyKey: `opening_balance:${args.openingId ?? args.entryDate}`,
      ready: false,
      errors,
    };
  }

  const gate = assessJournalBalance(built.lines);
  const totalDebits = round2(
    built.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
  );
  const totalCredits = round2(
    built.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0),
  );

  if (!gate.ok) errors.push(gate.error);

  return {
    entryDate: args.entryDate,
    lines: args.lines,
    totalDebits,
    totalCredits,
    balanced: gate.ok,
    idempotencyKey: built.idempotencyKey,
    ready: errors.length === 0 && gate.ok,
    errors,
  };
}

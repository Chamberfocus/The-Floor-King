/**
 * In-home close helpers. Floorzap's visit is: text the quote, take a deposit,
 * and later remind the customer when a balance is still open.
 * Money is recorded by the existing deposit RPC. These helpers only decide
 * the words, the amount, and whether a reminder is due.
 */

import type { PaymentMethod } from "@/lib/types";

export const VISIT_DEPOSIT_METHODS = [
  "cash",
  "check",
  "card",
  "echeck",
  "financing",
  "other",
] as const satisfies readonly PaymentMethod[];

export const BALANCE_REMINDER_PREFIX = "Balance reminder sent";
export const BALANCE_REMINDER_GAP_MS = 7 * 24 * 60 * 60 * 1000;
export const BALANCE_REMINDER_GRACE_DAYS = 3;
export const BALANCE_REMINDER_SCAN_LIMIT = 40;
export const BALANCE_REMINDER_SEND_LIMIT = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

export function quoteText(args: {
  firstName: string;
  company: string;
  url: string;
}): string {
  const who = args.firstName.trim() || "there";
  return `Hi ${who}, your estimate from ${args.company} is ready to review and approve: ${args.url}`;
}

export function balanceReminderText(args: {
  firstName: string;
  company: string;
  amount: string;
  url: string;
}): string {
  const who = args.firstName.trim() || "there";
  return `Hi ${who}, ${args.company} shows ${args.amount} still open on your account. You can review it here: ${args.url}`;
}

export function balanceReminderLog(amount: string): string {
  return `${BALANCE_REMINDER_PREFIX} ${amount}`;
}

export function visitDepositAmount(raw: string): number | null {
  const n = Number(String(raw).replace(/[$,]/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function visitDepositMethod(raw: string): PaymentMethod | null {
  const method = raw.trim() as PaymentMethod;
  return (VISIT_DEPOSIT_METHODS as readonly string[]).includes(method)
    ? method
    : null;
}

export function invoiceOldEnoughForReminder(
  issueDate: string,
  todayYmd: string,
  graceDays: number = BALANCE_REMINDER_GRACE_DAYS,
): boolean {
  const issue = Date.parse(`${issueDate}T00:00:00Z`);
  const today = Date.parse(`${todayYmd}T00:00:00Z`);
  if (!Number.isFinite(issue) || !Number.isFinite(today)) return false;
  return today - issue >= graceDays * DAY_MS;
}

export function balanceReminderDue(args: {
  lastSentAt: string | null;
  nowMs: number;
  gapMs?: number;
}): boolean {
  if (!args.lastSentAt) return true;
  const sent = Date.parse(args.lastSentAt);
  if (!Number.isFinite(sent)) return true;
  return args.nowMs - sent >= (args.gapMs ?? BALANCE_REMINDER_GAP_MS);
}

export type BalanceReminderCandidate = {
  customerId: string;
  issueDate: string;
  archived: boolean;
  email: string | null;
  phone: string | null;
};

/** Oldest open invoice per customer, skipping archived people and people we cannot reach. */
export function pickBalanceReminderCustomers(
  rows: BalanceReminderCandidate[],
  todayYmd: string,
  limit: number,
): BalanceReminderCandidate[] {
  const byCustomer = new Map<string, BalanceReminderCandidate>();
  for (const row of rows) {
    if (!row.customerId || row.archived) continue;
    if (!row.email?.trim() && !row.phone?.trim()) continue;
    if (!invoiceOldEnoughForReminder(row.issueDate, todayYmd)) continue;
    const prev = byCustomer.get(row.customerId);
    if (!prev || row.issueDate < prev.issueDate) byCustomer.set(row.customerId, row);
  }
  return [...byCustomer.values()]
    .sort(
      (a, b) =>
        a.issueDate.localeCompare(b.issueDate) ||
        a.customerId.localeCompare(b.customerId),
    )
    .slice(0, Math.max(0, limit));
}

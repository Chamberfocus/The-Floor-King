/**
 * A PNC ACH debit file.
 * PNC accepts a NACHA file in PINACLE. The invoice stays unpaid until
 * someone marks the deposit settled. The bank account number is only
 * in the file, never in the row we store.
 */

export type AchCompany = {
  destinationRouting: string;
  companyId: string;
  odfiRouting: string;
  companyName: string;
};

export type AchEntry = {
  routing: string;
  account: string;
  accountType: "checking" | "savings";
  amount: number;
  name: string;
  idNumber: string;
};

export type AchPullRow = {
  invoice_id: string;
  customer_id: string;
  amount: number;
  status: "ready";
  account_last4: string;
  routing_last4: string;
  account_type: "checking" | "savings";
  account_holder: string;
  created_by: string | null;
};

const WEIGHTS = [3, 7, 1, 3, 7, 1, 3, 7, 1];

export function routingIsValid(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const sum = routing.split("").reduce((total, digit, index) => total + Number(digit) * WEIGHTS[index], 0);
  return sum % 10 === 0;
}

/** Nine-digit EIN becomes the 10-character company id PNC expects (1 + EIN). */
export function normalizeCompanyId(raw: string): string | null {
  const value = raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (/^\d{9}$/.test(value)) return `1${value}`;
  if (/^[0-9A-Z]{10}$/.test(value)) return value;
  return null;
}

export function achCompanyFromSettings(org: {
  ach_destination_routing?: string | null;
  ach_company_id?: string | null;
  ach_odfi_routing?: string | null;
  ach_company_name?: string | null;
  company_name?: string | null;
}): { ok: true; company: AchCompany } | { ok: false; error: string } {
  const destination = (org.ach_destination_routing ?? "").replace(/\D/g, "");
  const odfi = (org.ach_odfi_routing ?? "").replace(/\D/g, "");
  const companyId = normalizeCompanyId(org.ach_company_id ?? "");
  const companyName = (org.ach_company_name ?? "").trim() || (org.company_name ?? "").trim();
  if (!routingIsValid(destination) || !routingIsValid(odfi) || !companyId || !companyName) {
    return {
      ok: false,
      error: "Add the PNC routing numbers and company id in Settings before sending an ACH file.",
    };
  }
  return {
    ok: true,
    company: { destinationRouting: destination, companyId, odfiRouting: odfi, companyName },
  };
}

function field(value: string, length: number, align: "left" | "right" = "left", pad = " "): string {
  const clean = value.replace(/[^\x20-\x7E]/g, "").slice(0, length);
  return align === "right" ? clean.padStart(length, pad) : clean.padEnd(length, pad);
}

function yymmdd(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}${pick("month")}${pick("day")}`;
}

function hhmm(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("hour")}${pick("minute")}`;
}

/** The next weekday in Eastern time. PNC settles on a banking day. */
export function nextBankingDay(now: Date): Date {
  const probe = new Date(now.getTime());
  for (let i = 0; i < 7; i++) {
    probe.setTime(probe.getTime() + 86_400_000);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
    }).format(probe);
    if (weekday !== "Sat" && weekday !== "Sun") return new Date(probe.getTime());
  }
  return new Date(probe.getTime());
}

function cents(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const value = Math.round(amount * 100);
  if (value <= 0 || value > 9_999_999_999) return null;
  return value;
}

export function buildNachaDebitFile(args: {
  company: AchCompany;
  entries: readonly AchEntry[];
  createdAt: Date;
  fileId?: string;
}): { ok: true; file: string; filenameSafeId: string } | { ok: false; error: string } {
  if (!args.entries.length) return { ok: false, error: "Nothing to send." };
  if (!routingIsValid(args.company.destinationRouting) || !routingIsValid(args.company.odfiRouting)) {
    return { ok: false, error: "The PNC routing number is not valid." };
  }
  const companyId = normalizeCompanyId(args.company.companyId);
  if (!companyId) return { ok: false, error: "The PNC company id must be 10 characters." };

  const lines: string[] = [];
  const fileId = (args.fileId ?? "A").slice(0, 1).toUpperCase();
  const created = yymmdd(args.createdAt);
  const effective = yymmdd(nextBankingDay(args.createdAt));
  lines.push(
    `101` +
      field(args.company.destinationRouting, 10, "right") +
      field(companyId, 10) +
      created +
      hhmm(args.createdAt) +
      fileId +
      `094101` +
      field("PNC BANK", 23) +
      field(args.company.companyName, 23) +
      field("", 8),
  );

  lines.push(
    `5` +
      `225` +
      field(args.company.companyName, 16) +
      field("", 20) +
      field(companyId, 10) +
      `PPD` +
      field("FLOORING", 10) +
      field(effective, 6) +
      effective +
      field("", 3) +
      `1` +
      args.company.odfiRouting.slice(0, 8) +
      `0000001`,
  );

  let hash = 0;
  let debit = 0;
  args.entries.forEach((entry, index) => {
    const account = entry.account.replace(/\D/g, "");
    const amount = cents(entry.amount);
    if (!routingIsValid(entry.routing) || account.length < 4 || account.length > 17 || amount == null) {
      lines.push("INVALID");
      return;
    }
    hash += Number(entry.routing.slice(0, 8));
    debit += amount;
    const code = entry.accountType === "savings" ? "37" : "27";
    const trace = `${args.company.odfiRouting.slice(0, 8)}${String(index + 1).padStart(7, "0")}`;
    lines.push(
      `6` +
        code +
        entry.routing +
        field(account, 17) +
        String(amount).padStart(10, "0") +
        field(entry.idNumber, 15) +
        field(entry.name, 22) +
        field("", 2) +
        `0` +
        trace,
    );
  });
  if (lines.some((line) => line === "INVALID") || lines.slice(2).some((line) => line.length !== 94)) {
    return { ok: false, error: "Check the routing number, account number, and amount." };
  }

  const count = args.entries.length;
  const hashField = String(hash % 10_000_000_000).padStart(10, "0");
  const debitField = String(debit).padStart(12, "0");
  lines.push(
    `8` +
      `225` +
      String(count).padStart(6, "0") +
      hashField +
      debitField +
      field("", 12, "right", "0") +
      field(companyId, 10) +
      field("", 19) +
      field("", 6) +
      args.company.odfiRouting.slice(0, 8) +
      `0000001`,
  );
  const recordCount = lines.length + 1;
  const blockCount = Math.ceil(recordCount / 10);
  lines.push(
    `9` +
      String(1).padStart(6, "0") +
      String(blockCount).padStart(6, "0") +
      String(count).padStart(8, "0") +
      hashField +
      debitField +
      field("", 12, "right", "0") +
      field("", 39),
  );
  while (lines.length % 10 !== 0) lines.push("9".repeat(94));
  if (lines.some((line) => line.length !== 94)) {
    return { ok: false, error: "The PNC file could not be built." };
  }
  return { ok: true, file: `${lines.join("\n")}\n`, filenameSafeId: fileId };
}

/**
 * The row saved on the invoice. The full account number is not a column.
 */
export function achPullRow(args: {
  invoiceId: string;
  customerId: string;
  amount: number;
  routing: string;
  account: string;
  accountType: "checking" | "savings";
  holder: string;
  createdBy: string | null;
}): AchPullRow | null {
  const account = args.account.replace(/\D/g, "");
  const routing = args.routing.replace(/\D/g, "");
  if (!routingIsValid(routing) || account.length < 4 || account.length > 17) return null;
  const amount = cents(args.amount);
  if (amount == null) return null;
  return {
    invoice_id: args.invoiceId,
    customer_id: args.customerId,
    amount: amount / 100,
    status: "ready",
    account_last4: account.slice(-4),
    routing_last4: routing.slice(-4),
    account_type: args.accountType,
    account_holder: args.holder.trim().slice(0, 80),
    created_by: args.createdBy,
  };
}

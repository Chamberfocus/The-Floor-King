/**
 * Read a pasted supplier order confirmation or invoice into lines whose
 * amounts add up to the printed total. The same check runs again before
 * anything is saved, so a purchase order and a later bill are not both
 * counted as the job cost.
 */

export type PaperworkKind = "order_confirmation" | "vendor_invoice" | "other";

export interface PaperworkLine {
  description: string;
  quantity: number;
  unit: string;
  /** Price per unit. Adjusted when the printed line amount disagrees. */
  unitCost: number;
  /** Extended amount from the document, in dollars. */
  amount: number;
  warning: string | null;
}

export interface PaperworkDraft {
  kind: PaperworkKind;
  vendor: string;
  number: string;
  date: string;
  dueDate: string;
  eta: string;
  terms: string;
  shipTo: string;
  lines: PaperworkLine[];
  printedTotal: number | null;
  lineTotal: number;
  difference: number;
  balanced: boolean;
  warnings: string[];
}

const EMPTY: PaperworkDraft = {
  kind: "other",
  vendor: "",
  number: "",
  date: "",
  dueDate: "",
  eta: "",
  terms: "",
  shipTo: "",
  lines: [],
  printedTotal: null,
  lineTotal: 0,
  difference: 0,
  balanced: true,
  warnings: [],
};

const TITLE =
  /^(order confirmation|sales order|order acknowledgement|acknowledgment|invoice|vendor invoice|bill|packing slip|bill of lading|page \d+)$/i;

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

export function moneyRound(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseMoney(raw: string): number | null {
  const t = raw.replace(/[$,\s]/g, "");
  if (!t || t === "-" || t === "—" || /^n\/a$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? moneyRound(n) : null;
}

function parseQty(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function toIsoDate(raw: string): string {
  const t = raw.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return t;
  const us = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const named = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    if (month) return `${named[3]}-${month}-${named[2].padStart(2, "0")}`;
  }
  return "";
}

function normalizeUnit(raw: string): string {
  const u = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (["sy", "sqyd", "sqyard", "sqyards", "yard", "yards", "yd"].includes(u)) return "sq yd";
  if (["sf", "sqft", "sqfeet", "sqfoot"].includes(u)) return "sq ft";
  if (["ea", "each"].includes(u)) return "ea";
  if (["box", "bx", "ctn", "carton", "cartons"].includes(u)) return "box";
  if (["lf", "lnft", "ft"].includes(u)) return "lf";
  if (["roll", "rl"].includes(u)) return "roll";
  return raw.trim();
}

function kindFrom(text: string): PaperworkKind {
  const title = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const head = `${title}\n${text.slice(0, 500)}`;
  if (/\b(packing slip|bill of lading)\b/i.test(head) && !/\b(invoice|order confirmation)\b/i.test(head)) {
    return "other";
  }
  if (/\binvoice\b|\bamount due\b/i.test(head) && !/\border confirmation\b/i.test(title)) {
    return "vendor_invoice";
  }
  if (/\b(order confirmation|sales order|acknowledgement|acknowledgment)\b/i.test(head)) {
    return "order_confirmation";
  }
  if (/\binvoice\b/i.test(text)) return "vendor_invoice";
  if (/\border\b/i.test(text)) return "order_confirmation";
  return "other";
}

function field(text: string, labels: string[]): string {
  const names = labels.map((l) => l.replace(/\s+/g, "\\s+")).join("|");
  const m = text.match(new RegExp(`(?:${names})\\s*[:#]\\s*([^\\n]+)`, "i"));
  return m?.[1]?.trim() ?? "";
}

function grabDate(text: string, labels: string[]): string {
  const value = field(text, labels);
  const found = value.match(
    /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|[A-Za-z]+ \d{1,2},? \d{4})/,
  );
  return found ? toIsoDate(found[1]) : "";
}

const UNIT =
  "sq\\s*yd|sq\\s*ft|sqyd|sqft|sy|sf|yards?|yds?|ea|each|box|bx|ctn|cartons?|rolls?|rl|lf|lnft|ft";

const PRODUCT = new RegExp(
  `([A-Za-z][A-Za-z0-9][A-Za-z0-9 /#.'&-]{1,80}?)\\s+(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s+(${UNIT})\\s+\\$?(\\d{1,3}(?:,\\d{3})*\\.\\d{2}|\\d+\\.\\d{2})\\s+\\$?(\\d{1,3}(?:,\\d{3})*\\.\\d{2}|\\d+\\.\\d{2})`,
  "gi",
);

const CHARGE = /^(freight|shipping|delivery|fuel surcharge|sales tax|tax)\s+\$?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*$/i;
const TOTAL = /^(?:invoice total|grand total|amount due|balance due|total due|total)\s+\$?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})\s*$/i;

function isNoiseDescription(description: string): boolean {
  return /^(total|invoice total|grand total|amount due|balance due|total due|subtotal|page \d+)$/i.test(
    description.trim(),
  );
}

export function settleLine(input: {
  description: string;
  quantity: number | null;
  unit: string;
  unitCost: number | null;
  amount: number | null;
}): PaperworkLine | null {
  const description = input.description.replace(/\s+/g, " ").trim();
  if (!description || isNoiseDescription(description)) return null;
  let quantity = input.quantity;
  let unitCost = input.unitCost;
  let amount = input.amount;
  let warning: string | null = null;

  if (amount == null && quantity != null && unitCost != null) {
    amount = moneyRound(quantity * unitCost);
  }
  if ((quantity == null || quantity === 0) && amount != null) {
    quantity = 1;
    if (unitCost == null) unitCost = amount;
  }
  if (unitCost == null && quantity && amount != null) {
    unitCost = Math.round((amount / quantity) * 10000) / 10000;
  }
  if (quantity == null || unitCost == null || amount == null) return null;

  const expected = moneyRound(quantity * unitCost);
  if (Math.abs(expected - amount) > 0.02) {
    unitCost = Math.round((amount / quantity) * 10000) / 10000;
    warning = "Unit price was set from the printed line amount so the line matches the document.";
  }
  return {
    description,
    quantity,
    unit: normalizeUnit(input.unit || "ea"),
    unitCost,
    amount: moneyRound(amount),
    warning,
  };
}

export function finishPaperwork(input: {
  kind: PaperworkKind;
  vendor: string;
  number: string;
  date: string;
  dueDate: string;
  eta: string;
  terms: string;
  shipTo: string;
  lines: PaperworkLine[];
  printedTotal: number | null;
  warnings?: string[];
}): PaperworkDraft {
  const lines = input.lines.filter((l) => l.description && l.amount != null);
  const lineTotal = moneyRound(lines.reduce((s, l) => s + l.amount, 0));
  const printed = input.printedTotal == null ? null : moneyRound(input.printedTotal);
  const difference = printed == null ? 0 : moneyRound(lineTotal - printed);
  const balanced = printed == null || Math.abs(difference) <= 0.02;
  const warnings = [...(input.warnings ?? [])];
  for (const line of lines) {
    if (line.warning) warnings.push(`${line.description}: ${line.warning}`);
  }
  if (printed != null && !balanced) {
    warnings.push(
      `Lines add up to ${lineTotal.toFixed(2)} and the document total is ${printed.toFixed(2)}.`,
    );
  }
  return {
    kind: input.kind,
    vendor: input.vendor.trim(),
    number: input.number.trim(),
    date: input.date,
    dueDate: input.dueDate,
    eta: input.eta,
    terms: input.terms.trim(),
    shipTo: input.shipTo.trim(),
    lines,
    printedTotal: printed,
    lineTotal,
    difference,
    balanced,
    warnings,
  };
}

function shareName(shipTo: string, customerName: string): boolean {
  const words = (name: string) =>
    name
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2);
  const ship = new Set(words(shipTo));
  return words(customerName).some((w) => ship.has(w));
}

export function parsePaperwork(raw: string, customerName = ""): PaperworkDraft {
  const text = raw.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
  if (!text) return { ...EMPTY };

  const kind = kindFrom(text);
  const vendorField = field(text, ["vendor", "supplier", "sold by", "from"]);
  const linesOf = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const vendor =
    vendorField.split(/ {2,}|\t/)[0]?.trim() ||
    linesOf.find((l) => !TITLE.test(l) && !/^[A-Za-z ]{2,20}:/.test(l) && !/\d{3,}/.test(l)) ||
    "";

  const number =
    field(text, ["invoice number", "invoice no", "invoice #", "order number", "order no", "order #", "confirmation number", "sales order"]) ||
    "";
  const cleanNumber = number.replace(/^(number|no\.?|#)\s*/i, "").split(/\s+/)[0] ?? "";

  const date = grabDate(text, ["invoice date", "order date", "date"]);
  const dueDate = grabDate(text, ["due date", "payment due", "due"]);
  const eta = grabDate(text, ["eta", "ship date", "delivery date", "expected arrival", "expected"]);
  const terms = field(text, ["terms", "payment terms"]).replace(/\s{2,}.*/, "");
  const shipTo = field(text, ["ship to", "deliver to"]).split(/ {2,}|\t/)[0]?.trim() ?? "";

  const warnings: string[] = [];
  if (shipTo && customerName && !shareName(shipTo, customerName)) {
    warnings.push(`This paperwork is addressed to ${shipTo}.`);
  }

  const found: PaperworkLine[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(PRODUCT)) {
    const line = settleLine({
      description: match[1],
      quantity: parseQty(match[2]),
      unit: match[3],
      unitCost: parseMoney(match[4]),
      amount: parseMoney(match[5]),
    });
    if (!line) continue;
    const key = `${line.description}|${line.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(line);
  }

  let printedTotal: number | null = null;
  for (const row of linesOf) {
    const charge = row.match(CHARGE);
    if (charge) {
      const amount = parseMoney(charge[2]);
      const label = /^tax/i.test(charge[1]) ? "Sales tax" : "Freight";
      if (amount != null && amount !== 0 && !found.some((l) => l.description.toLowerCase() === label.toLowerCase() && l.amount === amount)) {
        const line = settleLine({
          description: label,
          quantity: 1,
          unit: "ea",
          unitCost: amount,
          amount,
        });
        if (line) found.push(line);
      }
      continue;
    }
    const total = row.match(TOTAL);
    if (total) printedTotal = parseMoney(total[1]);
  }
  if (printedTotal == null) {
    const loose = text.match(
      /(?:invoice total|grand total|amount due|balance due|total due)\s*[: ]\s*\$?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/i,
    );
    if (loose) printedTotal = parseMoney(loose[1]);
  }

  return finishPaperwork({
    kind,
    vendor,
    number: cleanNumber,
    date,
    dueDate,
    eta,
    terms,
    shipTo,
    lines: found,
    printedTotal,
    warnings,
  });
}

export function draftFromCharges(input: {
  kind: PaperworkKind;
  vendor: string | null;
  number: string | null;
  date: string | null;
  dueDate?: string | null;
  eta?: string | null;
  terms?: string | null;
  lines: {
    description: string;
    quantity: number | null;
    unit: string | null;
    unitCost: number | null;
    amount: number | null;
  }[];
  freight?: number | null;
  tax?: number | null;
  printedTotal: number | null;
}): PaperworkDraft {
  const lines: PaperworkLine[] = [];
  for (const row of input.lines) {
    const line = settleLine({
      description: row.description,
      quantity: row.quantity,
      unit: row.unit || "ea",
      unitCost: row.unitCost,
      amount: row.amount,
    });
    if (line) lines.push(line);
  }
  if (input.freight) {
    const freight = settleLine({
      description: "Freight",
      quantity: 1,
      unit: "ea",
      unitCost: input.freight,
      amount: input.freight,
    });
    if (freight) lines.push(freight);
  }
  if (input.tax) {
    const tax = settleLine({
      description: "Sales tax",
      quantity: 1,
      unit: "ea",
      unitCost: input.tax,
      amount: input.tax,
    });
    if (tax) lines.push(tax);
  }
  return finishPaperwork({
    kind: input.kind,
    vendor: input.vendor ?? "",
    number: input.number ?? "",
    date: toIsoDate(input.date ?? "") || (input.date ?? ""),
    dueDate: toIsoDate(input.dueDate ?? "") || "",
    eta: toIsoDate(input.eta ?? "") || "",
    terms: input.terms ?? "",
    shipTo: "",
    lines,
    printedTotal: input.printedTotal,
  });
}

/** Match a vendor name to a saved supplier. Exact, then a single partial match. */
export function matchSupplierId(
  vendor: string,
  suppliers: { id: string; name: string }[],
): string | null {
  const key = vendor.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key.length < 3) return null;
  const exact = suppliers.find(
    (s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, "") === key,
  );
  if (exact) return exact.id;
  const partial = suppliers.filter((s) => {
    const name = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return name.length >= 3 && (name.includes(key) || key.includes(name));
  });
  return partial.length === 1 ? partial[0].id : null;
}

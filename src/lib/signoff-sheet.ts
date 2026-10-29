/**
 * Finished-job sign-off. Pure helpers only: the price alert, the payment
 * choice, and the salesperson notice. No database and no sending.
 */

export const SIGNOFF_PAYMENT_CHOICES = ["pay_now", "contact_store"] as const;

export type SignoffPaymentChoice = (typeof SIGNOFF_PAYMENT_CHOICES)[number];

export type SignoffMoneyInvoice = {
  id: string;
  status: string;
  /** original | replacement | supplemental | null */
  commercialKind: string | null;
  /** Tax-inclusive total. */
  total: number;
  taxRatePct: number;
};

export type SignoffMoneyExtra = {
  amount: number;
  invoiceId: string | null;
};

export type SignoffPriceAlert = {
  show: boolean;
  originalTotal: number;
  invoiceTotal: number;
  /** Invoice price now, plus change orders that are not on an invoice yet, minus the original. */
  changeOrderTotal: number;
  uninvoicedExtraTotal: number;
};

export function paymentChoiceLabel(choice: SignoffPaymentChoice): string {
  return choice === "pay_now"
    ? "Pay the balance now"
    : "I will contact the store to pay";
}

export function parsePaymentChoice(value: string): SignoffPaymentChoice | null {
  return value === "pay_now" || value === "contact_store" ? value : null;
}

function cents(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function gross(amount: number, taxRatePct: number): number {
  const rate = Number.isFinite(taxRatePct) ? taxRatePct : 0;
  return cents(amount * (1 + rate / 100));
}

/**
 * A change order made the invoice price different when signed extras or a
 * supplemental / replacement / additional invoice move the bill off the
 * original price. Extras already inside an invoice are not counted twice.
 */
export function signoffPriceAlert(input: {
  invoices: SignoffMoneyInvoice[];
  extras: SignoffMoneyExtra[];
}): SignoffPriceAlert {
  const invoices = input.invoices.map((inv) => ({
    id: inv.id,
    status: (inv.status || "").toLowerCase(),
    commercialKind: inv.commercialKind || null,
    total: cents(inv.total),
    taxRatePct: Number.isFinite(inv.taxRatePct) ? inv.taxRatePct : 0,
  }));
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const active = invoices.filter((inv) => inv.status !== "void");
  const extrasOn = new Map<string, number>();
  let uninvoicedPreTax = 0;

  for (const extra of input.extras) {
    const amount = cents(extra.amount);
    if (amount === 0) continue;
    const host = extra.invoiceId ? byId.get(extra.invoiceId) : undefined;
    if (!host || host.status === "void") {
      if (!host) uninvoicedPreTax = cents(uninvoicedPreTax + amount);
      continue;
    }
    extrasOn.set(
      host.id,
      cents((extrasOn.get(host.id) ?? 0) + gross(amount, host.taxRatePct)),
    );
  }

  const replacement = active.find((inv) => inv.commercialKind === "replacement");
  const contract = active.find(
    (inv) => inv.commercialKind !== "supplemental" && inv.commercialKind !== "replacement",
  );
  const onlySupplementals =
    active.length > 0 && active.every((inv) => inv.commercialKind === "supplemental");

  let original = 0;
  if (replacement) {
    const voided =
      [...invoices].reverse().find((inv) => inv.status === "void" && inv.commercialKind === "original") ??
      [...invoices].reverse().find((inv) => inv.status === "void");
    original = voided
      ? voided.total
      : cents(replacement.total - (extrasOn.get(replacement.id) ?? 0));
  } else if (onlySupplementals) {
    original = 0;
  } else if (contract) {
    original = cents(contract.total - (extrasOn.get(contract.id) ?? 0));
  } else if (active[0]) {
    original = cents(active[0].total - (extrasOn.get(active[0].id) ?? 0));
  }
  original = Math.max(0, original);

  const invoiceTotal = cents(active.reduce((sum, inv) => sum + inv.total, 0));
  const taxForUninvoiced =
    contract?.taxRatePct ?? replacement?.taxRatePct ?? active[0]?.taxRatePct ?? 0;
  const uninvoicedExtraTotal = gross(uninvoicedPreTax, taxForUninvoiced);
  const priceNow = cents(invoiceTotal + uninvoicedExtraTotal);
  const changeOrderTotal = cents(priceNow - original);
  const show =
    Math.abs(changeOrderTotal) >= 0.01 && (active.length > 0 || uninvoicedExtraTotal >= 0.01);

  return {
    show,
    originalTotal: original,
    invoiceTotal,
    changeOrderTotal,
    uninvoicedExtraTotal,
  };
}

export function signoffNeedsPaymentChoice(input: {
  balance: number;
  uninvoicedExtraTotal: number;
}): boolean {
  return input.balance > 0.009 || input.uninvoicedExtraTotal > 0.009;
}

export function signoffPriceAlertCopy(
  alert: SignoffPriceAlert,
  money: (n: number) => string,
): { title: string; detail: string } | null {
  if (!alert.show) return null;
  const title = "Change order changed the invoice price";
  if (alert.invoiceTotal <= 0 && alert.uninvoicedExtraTotal > 0) {
    return {
      title,
      detail: `A change order of ${money(alert.uninvoicedExtraTotal)} is not on an invoice yet.`,
    };
  }
  const parts: string[] = [];
  if (alert.originalTotal > 0 && Math.abs(alert.invoiceTotal - alert.originalTotal) >= 0.01) {
    parts.push(
      `The original price was ${money(alert.originalTotal)}. The invoice is now ${money(alert.invoiceTotal)}.`,
    );
  } else if (alert.originalTotal <= 0 && alert.invoiceTotal > 0) {
    parts.push(`A change-order invoice is ${money(alert.invoiceTotal)}. There is no original invoice on this job.`);
  } else {
    parts.push(`The invoice is ${money(alert.invoiceTotal)}.`);
  }
  if (alert.uninvoicedExtraTotal >= 0.01) {
    parts.push(
      `Change orders of ${money(alert.uninvoicedExtraTotal)} are not on the invoice yet. With them, the price is ${money(cents(alert.invoiceTotal + alert.uninvoicedExtraTotal))}.`,
    );
  } else if (Math.abs(alert.changeOrderTotal) >= 0.01 && alert.originalTotal > 0) {
    const direction = alert.changeOrderTotal > 0 ? "higher" : "lower";
    parts.push(
      `That is ${money(Math.abs(alert.changeOrderTotal))} ${direction} because of a change order.`,
    );
  }
  return { title, detail: parts.join(" ") };
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export function signoffNotice(input: {
  customerName: string;
  paymentChoice: SignoffPaymentChoice | null;
  balanceLabel: string;
  alert: SignoffPriceAlert;
  money: (n: number) => string;
  jobUrl: string;
}): { subject: string; sms: string; heading: string; bodyHtml: string } {
  const name = input.customerName.trim() || "Customer";
  const choiceLine =
    input.paymentChoice === "pay_now"
      ? "They want to pay the balance now."
      : input.paymentChoice === "contact_store"
        ? "They will contact the store to make payment."
        : "No balance was due at sign-off.";
  const alertCopy = signoffPriceAlertCopy(input.alert, input.money);
  const subject = `Job signed: ${clip(name, 60)}`;
  const heading = `${name} signed the finished job`;
  const alertText = alertCopy ? ` ${alertCopy.title}.` : "";
  const smsBody = `Floor King: ${clip(name, 40)} signed the finished job. ${choiceLine} Balance ${input.balanceLabel}.${alertText}`;
  const sms =
    `${smsBody} ${input.jobUrl}`.length <= 320
      ? `${smsBody} ${input.jobUrl}`
      : `${clip(smsBody, 300)} ${input.jobUrl}`;
  const bodyHtml = [
    `<p><strong>${esc(name)}</strong> signed that the job is finished.</p>`,
    `<p>${esc(choiceLine)} Balance <strong>${esc(input.balanceLabel)}</strong>.</p>`,
    alertCopy
      ? `<p><strong>${esc(alertCopy.title)}.</strong> ${esc(alertCopy.detail)}</p>`
      : "",
  ].join("");
  return { subject, sms, heading, bodyHtml };
}

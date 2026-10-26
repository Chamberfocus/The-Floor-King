function cents(n: number): number {
  return Math.round((Number(n) || 0) * 100);
}

export function invoicePayAllowed(
  balance: number,
): { ok: true; amount: number } | { ok: false; error: string } {
  const due = cents(balance);
  if (due <= 0) return { ok: false, error: "This invoice has no balance." };
  return { ok: true, amount: due / 100 };
}

/** What is still uncovered on a quote, in dollars. */
export function quoteDepositRoom(quoteTotal: number, alreadyDeposited: number): number {
  const room = cents(quoteTotal) - cents(alreadyDeposited);
  return room > 0 ? room / 100 : 0;
}

/** A quote deposit cannot exceed what is still unpaid on that quote. */
export function quoteDepositAllowed(
  amount: number,
  quoteTotal: number,
  alreadyDeposited: number,
): { ok: true; amount: number } | { ok: false; error: string } {
  const room = cents(quoteTotal) - cents(alreadyDeposited);
  const paid = cents(amount);
  if (paid <= 0) return { ok: false, error: "Enter the amount you paid." };
  if (room <= 0) {
    return { ok: false, error: "This quote is already covered." };
  }
  if (paid > room) {
    return {
      ok: false,
      error: "That amount is more than what's left on this quote.",
    };
  }
  return { ok: true, amount: paid / 100 };
}

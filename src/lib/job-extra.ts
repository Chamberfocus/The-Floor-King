function cents(n: number): number {
  return Math.round((Number(n) || 0) * 100);
}

const MAX_EXTRA_CENTS = 100_000_00;

export function extraChargeAllowed(input: {
  description: string;
  amount: number;
  signer: string;
  signature: string;
}):
  | { ok: true; description: string; amount: number; signer: string }
  | { ok: false; error: string } {
  const description = input.description.trim().slice(0, 200);
  if (!description) return { ok: false, error: "Say what the extra work is." };
  const amountCents = cents(input.amount);
  if (amountCents <= 0) {
    return { ok: false, error: "Enter the amount they agreed to." };
  }
  if (amountCents > MAX_EXTRA_CENTS) {
    return { ok: false, error: "That amount is too large. Call the office." };
  }
  const signer = input.signer.trim().slice(0, 120);
  if (!signer) return { ok: false, error: "The customer signs their name." };
  const signature = input.signature.trim();
  if (!signature.startsWith("data:image/")) {
    return { ok: false, error: "The customer needs to sign on the screen." };
  }
  if (signature.length > 500_000) {
    return { ok: false, error: "That signature is too large. Sign again." };
  }
  return { ok: true, description, amount: amountCents / 100, signer };
}

export function rollTicketLine(roll: {
  productName: string;
  rollNumber: string | null;
  dyeLot: string | null;
  qty: number;
  unit: string;
}): string {
  const identity = [
    roll.rollNumber?.trim() ? `Roll ${roll.rollNumber.trim()}` : null,
    roll.dyeLot?.trim() ? `dye lot ${roll.dyeLot.trim()}` : "No dye lot written",
  ]
    .filter(Boolean)
    .join(" · ");
  const qty = `${roll.qty} ${roll.unit}`.trim();
  return [roll.productName.trim() || "Roll", identity, qty].filter(Boolean).join(" — ");
}

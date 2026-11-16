/**
 * Who an estimate may be emailed or texted to, after the salesperson checks
 * the preview. The first address is the customer file. Extra addresses are
 * additional recipients for this send only.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEstimateEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEstimateEmail(raw: string): boolean {
  const email = cleanEstimateEmail(raw);
  return email.length > 0 && email.length <= 200 && EMAIL_RE.test(email);
}

/** Digits only, for comparing two phone fields that differ by formatting. */
export function estimatePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function isEstimatePhone(raw: string): boolean {
  const digits = estimatePhoneDigits(raw);
  return digits.length === 10;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function estimateEmailRecipients(primary: string, extra: string): {
  emails: string[];
  rejected: string[];
} {
  const emails: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const part of [primary, ...splitList(extra)]) {
    if (!part.trim()) continue;
    if (!isEstimateEmail(part)) {
      rejected.push(part.trim());
      continue;
    }
    const email = cleanEstimateEmail(part);
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }
  return { emails, rejected };
}

export function estimatePhoneRecipients(primary: string, extra: string): {
  phones: string[];
  rejected: string[];
} {
  const phones: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const part of [primary, ...splitList(extra)]) {
    if (!part.trim()) continue;
    if (!isEstimatePhone(part)) {
      rejected.push(part.trim());
      continue;
    }
    const digits = estimatePhoneDigits(part);
    if (seen.has(digits)) continue;
    seen.add(digits);
    phones.push(part.trim());
  }
  return { phones, rejected };
}

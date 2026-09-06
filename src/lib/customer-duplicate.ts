/**
 * F2 customer duplicate prevention — pure normalization + confidence.
 * No automatic merge.
 */

export type DuplicateConfidence = "high" | "possible";
export type DuplicateReason = "phone" | "email" | "name" | "name_address";

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Digits only; if 11 and starts with 1, drop country code. */
export function normalizePhoneDigits(phone: string | null | undefined): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}

export function normalizePersonName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeAddressKey(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const zip = (parts.zip ?? "").replace(/\D/g, "").slice(0, 5);
  return [
    (parts.address ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    (parts.city ?? "").trim().toLowerCase(),
    (parts.state ?? "").trim().toLowerCase(),
    zip,
  ]
    .filter(Boolean)
    .join("|");
}

export interface DuplicateCandidateInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface ExistingCustomerLike {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}

export interface ScoredDuplicate {
  id: string;
  reason: DuplicateReason;
  confidence: DuplicateConfidence;
}

/**
 * Score one existing customer against a create candidate.
 * High = same email or same 10-digit phone.
 * Possible = exact normalized name, or name + address key.
 */
export function scoreCustomerDuplicate(
  candidate: DuplicateCandidateInput,
  existing: ExistingCustomerLike,
): ScoredDuplicate | null {
  const cEmail = normalizeEmail(candidate.email);
  const eEmail = normalizeEmail(existing.email);
  if (cEmail && eEmail && cEmail === eEmail) {
    return { id: existing.id, reason: "email", confidence: "high" };
  }

  const cPhone = normalizePhoneDigits(candidate.phone);
  const ePhone = normalizePhoneDigits(existing.phone);
  if (cPhone.length === 10 && ePhone.length === 10 && cPhone === ePhone) {
    return { id: existing.id, reason: "phone", confidence: "high" };
  }

  const cName = normalizePersonName(candidate.fullName);
  const eName = normalizePersonName(existing.full_name);
  if (!cName || cName !== eName) return null;

  const cAddr = normalizeAddressKey(candidate);
  const eAddr = normalizeAddressKey(existing);
  if (cAddr && eAddr && cAddr === eAddr) {
    return { id: existing.id, reason: "name_address", confidence: "possible" };
  }

  return { id: existing.id, reason: "name", confidence: "possible" };
}

export function classifyDuplicateMatches(
  matches: { reason: DuplicateReason; confidence: DuplicateConfidence }[],
): {
  hasHigh: boolean;
  hasPossible: boolean;
  requiresOverrideReason: boolean;
} {
  const hasHigh = matches.some((m) => m.confidence === "high");
  const hasPossible = matches.some((m) => m.confidence === "possible");
  return {
    hasHigh,
    hasPossible,
    requiresOverrideReason: hasHigh,
  };
}

export function assessDuplicateOverride(args: {
  hasHighConfidenceMatch: boolean;
  forceCreate: boolean;
  overrideReason: string | null | undefined;
  actorRole: string;
}): { ok: true } | { ok: false; error: string } {
  if (!args.hasHighConfidenceMatch) return { ok: true };
  if (!args.forceCreate) {
    return {
      ok: false,
      error: "A matching customer already exists. Open the existing file or confirm create with a reason.",
    };
  }
  const reason = (args.overrideReason ?? "").trim();
  if (!reason) {
    return {
      ok: false,
      error: "An override reason is required to create a customer with the same phone or email.",
    };
  }
  if (!["admin", "office", "sales_manager"].includes(args.actorRole)) {
    return {
      ok: false,
      error: "Only office/admin/sales managers can override a high-confidence duplicate.",
    };
  }
  return { ok: true };
}

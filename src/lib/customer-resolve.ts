/**
 * Canonical customer matching + resolve/create decisions.
 *
 * Every workflow that can insert a customers row must go through this module
 * (or the server helper that wraps it). Do not copy matching rules into
 * individual actions.
 *
 * Never auto-merge existing records. Never unique-index name/phone/email.
 * Weak matches are never auto-reused.
 */
import {
  assessDuplicateOverride,
  normalizeAddressKey,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneDigits,
  scoreCustomerDuplicate,
  type DuplicateCandidateInput,
  type DuplicateConfidence,
  type DuplicateReason,
  type ExistingCustomerLike,
} from "@/lib/customer-duplicate";

export type MatchTier = "strong" | "medium" | "weak";

export type MatchReason =
  | "phone"
  | "email"
  | "phone_name"
  | "email_name"
  | "name_address"
  | "phone_suffix"
  | "name"
  | "last_name"
  | "address"
  | "company";

export interface MatchCandidateInput extends DuplicateCandidateInput {
  company?: string | null;
}

export interface MatchableCustomer extends ExistingCustomerLike {
  company?: string | null;
  street?: string | null;
  assigned_to?: string | null;
  workflow_owner_id?: string | null;
  jobCount?: number;
  lastActivityAt?: string | null;
}

export interface ScoredCustomerMatch {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  street: string | null;
  company: string | null;
  reason: MatchReason;
  tier: MatchTier;
  confidence: DuplicateConfidence;
  legacyReason: DuplicateReason;
  jobCount: number;
  lastActivityAt: string | null;
  assigned_to: string | null;
  workflow_owner_id: string | null;
}

export type StaffResolveDecision =
  | { action: "use_existing"; customerId: string }
  | { action: "create" }
  | { action: "needs_choice"; matches: ScoredCustomerMatch[] }
  | { action: "blocked"; error: string };

export type PublicBookingDecision =
  | { action: "link_existing"; customerId: string }
  | { action: "create_new"; needsStaffReview: boolean };

export type ImportRowClass =
  | "NEW"
  | "MATCHED_EXISTING"
  | "POSSIBLE_DUPLICATE"
  | "INVALID";

export interface ClassifiedImportRow {
  index: number;
  class: ImportRowClass;
  input: MatchCandidateInput;
  matchedId: string | null;
  reason: MatchReason | "batch" | null;
}

const TIER_RANK: Record<MatchTier, number> = {
  strong: 3,
  medium: 2,
  weak: 1,
};

function lastNameOf(name: string): string {
  const parts = normalizePersonName(name).split(" ").filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1]! : "";
}

function namesSimilar(a: string, b: string): boolean {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const la = lastNameOf(a);
  const lb = lastNameOf(b);
  if (la && la === lb && la.length >= 4) {
    const fa = na.split(" ")[0];
    const fb = nb.split(" ")[0];
    return !!fa && fa === fb;
  }
  return false;
}

function phoneLast4(digits: string): string {
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function asAddress(existing: MatchableCustomer): string | null {
  return existing.address ?? existing.street ?? null;
}

/**
 * Score one existing row. Conservative: exact identifiers are strong;
 * name+address is medium; name-only is weak and never auto-reused.
 */
export function scoreCustomerMatch(
  candidate: MatchCandidateInput,
  existing: MatchableCustomer,
): ScoredCustomerMatch | null {
  const cEmail = normalizeEmail(candidate.email);
  const eEmail = normalizeEmail(existing.email);
  const cPhone = normalizePhoneDigits(candidate.phone);
  const ePhone = normalizePhoneDigits(existing.phone);
  const cName = normalizePersonName(candidate.fullName);
  const eName = normalizePersonName(existing.full_name);
  const similarName = namesSimilar(candidate.fullName, existing.full_name);
  const exactName = !!cName && cName === eName;

  const cAddr = normalizeAddressKey({
    address: candidate.address,
    city: candidate.city,
    state: candidate.state,
    zip: candidate.zip,
  });
  const eAddr = normalizeAddressKey({
    address: asAddress(existing),
    city: existing.city,
    state: existing.state,
    zip: existing.zip,
  });

  let reason: MatchReason | null = null;
  let tier: MatchTier | null = null;

  if (cEmail && eEmail && cEmail === eEmail) {
    reason = similarName ? "email_name" : "email";
    tier = "strong";
  } else if (
    cPhone.length === 10 &&
    ePhone.length === 10 &&
    cPhone === ePhone
  ) {
    reason = similarName ? "phone_name" : "phone";
    tier = "strong";
  } else if (exactName && cAddr && eAddr && cAddr === eAddr) {
    reason = "name_address";
    tier = "medium";
  } else if (
    exactName &&
    phoneLast4(cPhone) &&
    phoneLast4(cPhone) === phoneLast4(ePhone) &&
    (cPhone.length >= 4 || ePhone.length >= 4)
  ) {
    reason = "phone_suffix";
    tier = "medium";
  } else if (exactName) {
    reason = "name";
    tier = "weak";
  } else {
    return null;
  }

  const legacy = scoreCustomerDuplicate(candidate, {
    ...existing,
    address: asAddress(existing),
  });

  return {
    id: existing.id,
    full_name: existing.full_name,
    email: existing.email ?? null,
    phone: existing.phone ?? null,
    city: existing.city ?? null,
    street: asAddress(existing),
    company: existing.company ?? null,
    reason,
    tier,
    confidence: tier === "strong" ? "high" : "possible",
    legacyReason: legacy?.reason ?? (reason === "name_address" ? "name_address" : reason === "email" || reason === "email_name" ? "email" : reason === "phone" || reason === "phone_name" ? "phone" : "name"),
    jobCount: existing.jobCount ?? 0,
    lastActivityAt: existing.lastActivityAt ?? null,
    assigned_to: existing.assigned_to ?? null,
    workflow_owner_id: existing.workflow_owner_id ?? null,
  };
}

/** Score a pool. Does not hide distinct customer IDs. */
export function findPotentialCustomerMatches(
  input: MatchCandidateInput,
  existing: MatchableCustomer[],
): ScoredCustomerMatch[] {
  const out: ScoredCustomerMatch[] = [];
  for (const row of existing) {
    const scored = scoreCustomerMatch(input, row);
    if (scored) out.push(scored);
  }
  out.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  return out;
}

export function blockingMatches(
  matches: ScoredCustomerMatch[],
): ScoredCustomerMatch[] {
  return matches.filter(
    (m) =>
      m.tier === "strong" ||
      m.tier === "medium" ||
      (m.tier === "weak" && m.reason === "name"),
  );
}

export function salesmanMayAccessMatch(
  customer: Pick<MatchableCustomer, "assigned_to" | "workflow_owner_id">,
  salesmanId: string,
): boolean {
  if (!salesmanId) return false;
  return (
    customer.assigned_to === salesmanId ||
    customer.workflow_owner_id === salesmanId
  );
}

/**
 * Staff matcher ACL: salesman only sees their book. Other internal roles keep
 * their existing broader access. Public callers must not use this.
 */
export function filterMatchesForActor(
  matches: ScoredCustomerMatch[],
  actor: { role: string; id: string },
): ScoredCustomerMatch[] {
  if (actor.role === "salesman") {
    return matches.filter((m) => salesmanMayAccessMatch(m, actor.id));
  }
  if (actor.role === "customer") return [];
  return matches;
}

export function decideStaffCreate(args: {
  input: MatchCandidateInput;
  matches: ScoredCustomerMatch[];
  useExistingId?: string | null;
  forceCreate?: boolean;
  overrideReason?: string | null;
  actorRole: string;
}): StaffResolveDecision {
  const existingId = (args.useExistingId ?? "").trim();
  if (existingId) {
    return { action: "use_existing", customerId: existingId };
  }

  const blocking = blockingMatches(args.matches);
  if (blocking.length && !args.forceCreate) {
    return { action: "needs_choice", matches: blocking };
  }

  if (blocking.length && args.forceCreate) {
    const gate = assessDuplicateOverride({
      hasHighConfidenceMatch: blocking.some((m) => m.tier === "strong"),
      forceCreate: true,
      overrideReason: args.overrideReason,
      actorRole: args.actorRole,
    });
    if (!gate.ok) return { action: "blocked", error: gate.error };
  }

  return { action: "create" };
}

/**
 * Recheck immediately before insert. If blocking matches exist now, do not
 * insert unless the caller already overrode. This is the concurrency
 * protection — no unique(phone/email/name) index.
 */
export function recheckBeforeInsert(args: {
  latest: ScoredCustomerMatch[];
  forceCreate?: boolean;
}): { ok: true } | { ok: false; matches: ScoredCustomerMatch[] } {
  if (args.forceCreate) return { ok: true };
  const latestBlocking = blockingMatches(args.latest);
  if (latestBlocking.length) return { ok: false, matches: latestBlocking };
  return { ok: true };
}

/**
 * Public booking: never leak match details. Auto-link only when exactly one
 * strong (exact phone or exact email) match exists.
 */
export function decidePublicBooking(
  matches: ScoredCustomerMatch[],
): PublicBookingDecision {
  const strong = matches.filter((m) => m.tier === "strong");
  if (strong.length === 1) {
    return { action: "link_existing", customerId: strong[0]!.id };
  }
  return {
    action: "create_new",
    // Any leftover match (multiple strong, medium, or weak name) is uncertain.
    // Never auto-link; stamp the new lead for staff review. No match details
    // are returned to the public caller.
    needsStaffReview: matches.length > 0,
  };
}

function importInputKey(input: MatchCandidateInput): string {
  const phone = normalizePhoneDigits(input.phone);
  const email = normalizeEmail(input.email);
  const name = normalizePersonName(input.fullName);
  const addr = normalizeAddressKey({
    address: input.address,
    city: input.city,
    state: input.state,
    zip: input.zip,
  });
  return [phone || "", email || "", name || "", addr || ""].join("~");
}

export function classifyImportRows(
  rows: MatchCandidateInput[],
  existing: MatchableCustomer[],
): ClassifiedImportRow[] {
  const pool: MatchableCustomer[] = [...existing];
  const seenKeys = new Map<string, number>();
  const out: ClassifiedImportRow[] = [];

  rows.forEach((input, index) => {
    const name = (input.fullName ?? "").trim();
    const company = (input.company ?? "").trim();
    if (!name && !company) {
      out.push({
        index,
        class: "INVALID",
        input,
        matchedId: null,
        reason: null,
      });
      return;
    }

    const key = importInputKey({ ...input, fullName: name || company });
    const prior = seenKeys.get(key);
    if (prior !== undefined && (key.replace(/~/g, "") !== "")) {
      out.push({
        index,
        class: "POSSIBLE_DUPLICATE",
        input,
        matchedId: null,
        reason: "batch",
      });
      return;
    }

    const matches = findPotentialCustomerMatches(
      { ...input, fullName: name || company },
      pool,
    );
    const strong = matches.find((m) => m.tier === "strong");
    const blocking = blockingMatches(matches);

    if (strong) {
      out.push({
        index,
        class: "MATCHED_EXISTING",
        input,
        matchedId: strong.id,
        reason: strong.reason,
      });
      return;
    }
    if (blocking.length) {
      out.push({
        index,
        class: "POSSIBLE_DUPLICATE",
        input,
        matchedId: blocking[0]!.id,
        reason: blocking[0]!.reason,
      });
      return;
    }

    seenKeys.set(key, index);
    pool.push({
      id: `import-row-${index}`,
      full_name: name || company,
      email: input.email,
      phone: input.phone,
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
      company: input.company,
    });
    out.push({
      index,
      class: "NEW",
      input,
      matchedId: null,
      reason: null,
    });
  });

  return out;
}

export function summarizeImport(rows: ClassifiedImportRow[]): {
  new: number;
  matchedExisting: number;
  possibleDuplicates: number;
  invalid: number;
} {
  return {
    new: rows.filter((r) => r.class === "NEW").length,
    matchedExisting: rows.filter((r) => r.class === "MATCHED_EXISTING").length,
    possibleDuplicates: rows.filter((r) => r.class === "POSSIBLE_DUPLICATE")
      .length,
    invalid: rows.filter((r) => r.class === "INVALID").length,
  };
}

export function publicBookingResponseSafe(ok: boolean, error?: string) {
  return {
    error: error ?? null,
    ok: ok || undefined,
  };
}

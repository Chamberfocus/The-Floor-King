/**
 * Existing-customer duplicate cleanup — read-only detection + merge decisions.
 *
 * Uses the same canonical normalization as src/lib/customer-duplicate.ts.
 * Never auto-merges. LOW confidence is never suggested as an automatic merge.
 */
import {
  normalizeAddressKey,
  normalizeEmail,
  normalizePersonName,
  normalizePhoneDigits,
} from "@/lib/customer-duplicate";
import { computeJobOpenBalance, type JobBalanceInvoiceInput } from "@/lib/invoice-calc";
import { MERGE_SQL_TABLES } from "@/lib/customer-reference-map";

export const DUPLICATE_REVIEW_ROLES = ["admin", "office", "sales_manager"] as const;
export const DUPLICATE_MERGE_ROLES = ["admin", "office"] as const;

export type CleanupConfidence = "high" | "medium" | "low";

export type CleanupMatchReason =
  | "phone"
  | "email"
  | "phone_name"
  | "email_name"
  | "name_address"
  | "company_contact"
  | "name_phone_suffix"
  | "name_address_support"
  | "name"
  | "last_name"
  | "address";

export type CleanupCustomer = {
  id: string;
  full_name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  merged_into_customer_id?: string | null;
  merged_at?: string | null;
  merged_by?: string | null;
  merge_reason?: string | null;
};

export type CleanupActivity = {
  jobCount: number;
  openJobCount: number;
  estimateCount: number;
  invoiceCount: number;
  openAr: number;
  cashAndCarryCount: number;
  appointmentCount: number;
  documentCount: number;
  noteCount: number;
  orderCount: number;
  depositCount: number;
  lastActivityAt: string | null;
};

export const EMPTY_CLEANUP_ACTIVITY: CleanupActivity = {
  jobCount: 0,
  openJobCount: 0,
  estimateCount: 0,
  invoiceCount: 0,
  openAr: 0,
  cashAndCarryCount: 0,
  appointmentCount: 0,
  documentCount: 0,
  noteCount: 0,
  orderCount: 0,
  depositCount: 0,
  lastActivityAt: null,
};

export type CleanupMember = CleanupCustomer &
  CleanupActivity & {
    salespersonName?: string | null;
  };

export type DuplicatePairClass = {
  a: string;
  b: string;
  confidence: CleanupConfidence;
  reasons: CleanupMatchReason[];
  label: string;
};

export type DuplicateGroup = {
  id: string;
  confidence: CleanupConfidence;
  reasons: CleanupMatchReason[];
  label: string;
  memberIds: string[];
  members: CleanupMember[];
  suppressed?: boolean;
  merged?: boolean;
};

export type ExclusionPair = {
  customer_id_a: string;
  customer_id_b: string;
  reason?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
};

export const PROFILE_MERGE_FIELDS = [
  "full_name",
  "phone",
  "email",
  "street",
  "city",
  "state",
  "zip",
  "company",
  "assigned_to",
  "notes",
] as const;

export type ProfileMergeField = (typeof PROFILE_MERGE_FIELDS)[number];
export type FieldChoice = "survivor" | "duplicate";
export type ChosenProfileFields = Partial<Record<ProfileMergeField, FieldChoice>>;

export type MergeMoveCounts = {
  jobs: number;
  estimates: number;
  invoices: number;
  payments: number;
  credits: number;
  deposits: number;
  writeOffs: number;
  refunds: number;
  cashAndCarry: number;
  orders: number;
  appointments: number;
  documents: number;
  notes: number;
  openAr: number;
};

export type FinancialSnapshot = {
  invoiceTotal: number;
  payments: number;
  creditApplications: number;
  depositApplications: number;
  writeOffs: number;
  openAr: number;
  depositBalances: number;
  refunds: number;
};

export type MergeBlockCode =
  | "NOT_AUTHORIZED"
  | "SAME_CUSTOMER"
  | "SURVIVOR_MERGED"
  | "DUPLICATE_MERGED"
  | "PORTAL_CONFLICT"
  | "DRAFT_CONFLICT"
  | "FIELD_CONFLICT"
  | "MERGE_IN_PROGRESS"
  | "IDEMPOTENCY_CONFLICT"
  | "MISSING_REASON"
  | "NOT_FOUND";

export type MergeDecision =
  | { ok: true }
  | { ok: false; code: MergeBlockCode; error: string };

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

function emailDomain(email: string): string {
  const e = normalizeEmail(email);
  const at = e.indexOf("@");
  return at >= 0 ? e.slice(at + 1) : "";
}

function companyKey(company: string | null | undefined): string {
  return normalizePersonName(company);
}

function addrOf(c: CleanupCustomer): string {
  return normalizeAddressKey({
    address: c.street,
    city: c.city,
    state: c.state,
    zip: c.zip,
  });
}

export function normalizeExclusionPair(
  a: string,
  b: string,
): { customer_id_a: string; customer_id_b: string } {
  return a < b
    ? { customer_id_a: a, customer_id_b: b }
    : { customer_id_a: b, customer_id_b: a };
}

export function exclusionKey(a: string, b: string): string {
  const p = normalizeExclusionPair(a, b);
  return `${p.customer_id_a}:${p.customer_id_b}`;
}

export function isMergedAway(
  c: Pick<CleanupCustomer, "merged_into_customer_id">,
): boolean {
  return !!c.merged_into_customer_id;
}

export function canonicalCustomerId(
  c: Pick<CleanupCustomer, "id" | "merged_into_customer_id">,
): string {
  return c.merged_into_customer_id || c.id;
}

export function mayViewDuplicateReview(role: string): boolean {
  return (DUPLICATE_REVIEW_ROLES as readonly string[]).includes(role);
}

export function mayMergeCustomers(role: string): boolean {
  return (DUPLICATE_MERGE_ROLES as readonly string[]).includes(role);
}

export function maskPhone(phone: string | null | undefined): string {
  const d = normalizePhoneDigits(phone);
  if (!d) return "";
  if (d.length < 4) return "•••";
  return `(•••) •••-${d.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string {
  const e = normalizeEmail(email);
  if (!e) return "";
  const at = e.indexOf("@");
  if (at < 1) return "•••";
  return `${e.slice(0, 1)}•••@${e.slice(at + 1)}`;
}

export function confidenceLabel(
  confidence: CleanupConfidence,
  reasons: CleanupMatchReason[],
): string {
  const bits = reasons.map((r) => {
    switch (r) {
      case "phone":
        return "exact phone";
      case "email":
        return "exact email";
      case "phone_name":
        return "exact phone + similar name";
      case "email_name":
        return "exact email + similar name";
      case "name_address":
        return "exact name + address";
      case "company_contact":
        return "same business + contact";
      case "name_phone_suffix":
        return "name + phone suffix";
      case "name_address_support":
        return "name/address overlap";
      case "name":
        return "same name only";
      case "last_name":
        return "same last name only";
      case "address":
        return "same address only";
      default:
        return r;
    }
  });
  return `${confidence.toUpperCase()} — ${bits.join(", ")}`;
}

/**
 * Classify one pair. Conservative: HIGH never includes name-only.
 * LOW must never be treated as an automatic merge suggestion.
 */
export function classifyCleanupPair(
  a: CleanupCustomer,
  b: CleanupCustomer,
): DuplicatePairClass | null {
  if (!a.id || !b.id || a.id === b.id) return null;
  if (isMergedAway(a) || isMergedAway(b)) return null;

  const emailA = normalizeEmail(a.email);
  const emailB = normalizeEmail(b.email);
  const phoneA = normalizePhoneDigits(a.phone);
  const phoneB = normalizePhoneDigits(b.phone);
  const nameA = normalizePersonName(a.full_name);
  const nameB = normalizePersonName(b.full_name);
  const similar = namesSimilar(a.full_name, b.full_name);
  const exactName = !!nameA && nameA === nameB;
  const addrA = addrOf(a);
  const addrB = addrOf(b);
  const exactAddr = !!addrA && !!addrB && addrA === addrB;
  const companyA = companyKey(a.company);
  const companyB = companyKey(b.company);
  const sameCompany = !!companyA && companyA === companyB;
  const exactPhone = phoneA.length === 10 && phoneB.length === 10 && phoneA === phoneB;
  const exactEmail = !!emailA && !!emailB && emailA === emailB;

  const reasons: CleanupMatchReason[] = [];
  let confidence: CleanupConfidence | null = null;

  if (exactPhone && similar) {
    reasons.push("phone_name");
    confidence = "high";
  } else if (exactPhone) {
    reasons.push("phone");
    confidence = "high";
  }
  if (exactEmail && similar) {
    reasons.push("email_name");
    confidence = "high";
  } else if (exactEmail) {
    reasons.push("email");
    confidence = "high";
  }
  if (exactName && exactAddr) {
    reasons.push("name_address");
    confidence = "high";
  }
  if (sameCompany && (exactPhone || exactEmail)) {
    reasons.push("company_contact");
    confidence = "high";
  }

  if (!confidence) {
    const suffix =
      phoneLast4(phoneA) && phoneLast4(phoneA) === phoneLast4(phoneB);
    const cityZip =
      (a.city ?? "").trim().toLowerCase() === (b.city ?? "").trim().toLowerCase() &&
      (a.zip ?? "").replace(/\D/g, "").slice(0, 5) ===
        (b.zip ?? "").replace(/\D/g, "").slice(0, 5) &&
      !!(a.city || a.zip);
    const emailSupport =
      !!emailDomain(emailA) && emailDomain(emailA) === emailDomain(emailB);
    if (exactName && suffix) {
      reasons.push("name_phone_suffix");
      confidence = "medium";
    } else if (similar && exactAddr && (suffix || emailSupport)) {
      reasons.push("name_address_support");
      confidence = "medium";
    } else if (sameCompany && (suffix || similar)) {
      reasons.push("company_contact");
      confidence = "medium";
    } else if (similar && cityZip && suffix) {
      reasons.push("name_address_support");
      confidence = "medium";
    }
  }

  if (!confidence) {
    if (exactName) {
      reasons.push("name");
      confidence = "low";
    } else if (exactAddr) {
      reasons.push("address");
      confidence = "low";
    } else {
      const la = lastNameOf(a.full_name);
      const lb = lastNameOf(b.full_name);
      if (la && la === lb && la.length >= 4) {
        reasons.push("last_name");
        confidence = "low";
      }
    }
  }

  if (!confidence || !reasons.length) return null;
  const [left, right] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return {
    a: left,
    b: right,
    confidence,
    reasons,
    label: confidenceLabel(confidence, reasons),
  };
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x) ?? x;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const [lo, hi] = ra < rb ? [ra, rb] : [rb, ra];
    this.parent.set(hi, lo);
    if (!this.parent.has(lo)) this.parent.set(lo, lo);
  }
}

function lastNameBucketOk(ids: string[], byId: Map<string, CleanupCustomer>): boolean {
  // "Smith" buckets of dozens are noise. Only emit last-name-only groups of 2.
  if (ids.length !== 2) return false;
  const [x, y] = ids;
  const a = byId.get(x!);
  const b = byId.get(y!);
  if (!a || !b) return false;
  return classifyCleanupPair(a, b)?.reasons.includes("last_name") === true;
}

export function findCleanupDuplicateGroups(args: {
  customers: CleanupCustomer[];
  activity?: Record<string, CleanupActivity>;
  exclusions?: ExclusionPair[];
  salespersonNames?: Record<string, string>;
}): DuplicateGroup[] {
  const byId = new Map<string, CleanupCustomer>();
  for (const c of args.customers) {
    if (!c.id || isMergedAway(c)) continue;
    byId.set(c.id, c);
  }
  const ids = [...byId.keys()];
  const excluded = new Set(
    (args.exclusions ?? []).map((e) =>
      exclusionKey(e.customer_id_a, e.customer_id_b),
    ),
  );

  const pairs: DuplicatePairClass[] = [];
  const seenPair = new Set<string>();

  const index = {
    phone: new Map<string, string[]>(),
    email: new Map<string, string[]>(),
    name: new Map<string, string[]>(),
    nameAddr: new Map<string, string[]>(),
    addr: new Map<string, string[]>(),
    last: new Map<string, string[]>(),
    company: new Map<string, string[]>(),
  };
  const push = (map: Map<string, string[]>, key: string, id: string) => {
    const arr = map.get(key) ?? [];
    arr.push(id);
    map.set(key, arr);
  };
  for (const c of byId.values()) {
    const p = normalizePhoneDigits(c.phone);
    if (p.length === 10) push(index.phone, p, c.id);
    const e = normalizeEmail(c.email);
    if (e) push(index.email, e, c.id);
    const n = normalizePersonName(c.full_name);
    if (n) push(index.name, n, c.id);
    const a = addrOf(c);
    if (n && a) push(index.nameAddr, `${n}|${a}`, c.id);
    if (a) push(index.addr, a, c.id);
    const ln = lastNameOf(c.full_name);
    if (ln.length >= 4) push(index.last, ln, c.id);
    const co = companyKey(c.company);
    if (co) push(index.company, co, c.id);
  }

  const consider = (bucket: string[]) => {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = byId.get(bucket[i]!);
        const b = byId.get(bucket[j]!);
        if (!a || !b) continue;
        const key = exclusionKey(a.id, b.id);
        if (excluded.has(key) || seenPair.has(key)) continue;
        const cls = classifyCleanupPair(a, b);
        if (!cls) continue;
        seenPair.add(key);
        pairs.push(cls);
      }
    }
  };

  for (const idsIn of index.phone.values()) consider(idsIn);
  for (const idsIn of index.email.values()) consider(idsIn);
  for (const idsIn of index.nameAddr.values()) consider(idsIn);
  for (const idsIn of index.name.values()) consider(idsIn);
  for (const idsIn of index.addr.values()) consider(idsIn);
  for (const idsIn of index.company.values()) consider(idsIn);
  for (const idsIn of index.last.values()) {
    if (lastNameBucketOk(idsIn, byId)) consider(idsIn);
  }

  const ufHigh = new UnionFind();
  const ufMed = new UnionFind();
  const claimed = new Set<string>();
  const highReasons = new Map<string, CleanupMatchReason[]>();
  const medReasons = new Map<string, CleanupMatchReason[]>();

  const addReasons = (
    map: Map<string, CleanupMatchReason[]>,
    id: string,
    reasons: CleanupMatchReason[],
  ) => {
    const cur = map.get(id) ?? [];
    for (const r of reasons) if (!cur.includes(r)) cur.push(r);
    map.set(id, cur);
  };

  for (const p of pairs) {
    if (p.confidence !== "high") continue;
    ufHigh.union(p.a, p.b);
    addReasons(highReasons, p.a, p.reasons);
    addReasons(highReasons, p.b, p.reasons);
  }
  const highGroups = new Map<string, string[]>();
  for (const id of ids) {
    if (!highReasons.has(id)) continue;
    const root = ufHigh.find(id);
    const arr = highGroups.get(root) ?? [];
    arr.push(id);
    highGroups.set(root, arr);
    claimed.add(id);
  }

  for (const p of pairs) {
    if (p.confidence !== "medium") continue;
    if (claimed.has(p.a) && claimed.has(p.b)) continue;
    ufMed.union(p.a, p.b);
    addReasons(medReasons, p.a, p.reasons);
    addReasons(medReasons, p.b, p.reasons);
  }
  const medGroups = new Map<string, string[]>();
  for (const id of ids) {
    if (!medReasons.has(id)) continue;
    const root = ufMed.find(id);
    const arr = medGroups.get(root) ?? [];
    if (!arr.includes(id)) arr.push(id);
    medGroups.set(root, arr);
  }

  const toMember = (id: string): CleanupMember => {
    const c = byId.get(id)!;
    const act = args.activity?.[id] ?? EMPTY_CLEANUP_ACTIVITY;
    return {
      ...c,
      ...act,
      salespersonName: c.assigned_to
        ? (args.salespersonNames?.[c.assigned_to] ?? null)
        : null,
    };
  };

  const out: DuplicateGroup[] = [];
  const emit = (
    confidence: CleanupConfidence,
    memberIds: string[],
    reasons: CleanupMatchReason[],
  ) => {
    const unique = [...new Set(memberIds)].sort();
    if (unique.length < 2) return;
    out.push({
      id: `${confidence}:${unique.join(",")}`,
      confidence,
      reasons,
      label: confidenceLabel(confidence, reasons),
      memberIds: unique,
      members: unique.map(toMember),
    });
  };

  for (const members of highGroups.values()) {
    const reasons = [...new Set(members.flatMap((id) => highReasons.get(id) ?? []))];
    emit("high", members, reasons);
  }
  for (const members of medGroups.values()) {
    const fresh = members.filter((id) => !claimed.has(id) || members.some((x) => !claimed.has(x)));
    const pairish = members.filter((id) => !highGroups.has(ufHigh.find(id)) || !claimed.has(id));
    const use = [...new Set([...fresh, ...pairish])];
    if (use.filter((id) => !claimed.has(id)).length === 0 && use.every((id) => claimed.has(id))) {
      continue;
    }
    const reasons = [...new Set(use.flatMap((id) => medReasons.get(id) ?? []))];
    emit("medium", use, reasons);
    for (const id of use) claimed.add(id);
  }

  for (const p of pairs) {
    if (p.confidence !== "low") continue;
    if (claimed.has(p.a) || claimed.has(p.b)) continue;
    emit("low", [p.a, p.b], p.reasons);
  }

  const rank: Record<CleanupConfidence, number> = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.memberIds.length - a.memberIds.length);
  return out;
}

export function summarizeDuplicateGroups(groups: DuplicateGroup[]): {
  totalCustomers: number;
  highGroups: number;
  mediumGroups: number;
  lowGroups: number;
  rowsInvolved: number;
  largestGroup: number;
} {
  const involved = new Set<string>();
  let largest = 0;
  for (const g of groups) {
    for (const id of g.memberIds) involved.add(id);
    if (g.memberIds.length > largest) largest = g.memberIds.length;
  }
  return {
    totalCustomers: 0,
    highGroups: groups.filter((g) => g.confidence === "high").length,
    mediumGroups: groups.filter((g) => g.confidence === "medium").length,
    lowGroups: groups.filter((g) => g.confidence === "low").length,
    rowsInvolved: involved.size,
    largestGroup: largest,
  };
}

export function filterDuplicateGroups(
  groups: DuplicateGroup[],
  filter: {
    confidence?: CleanupConfidence | "all" | "ignored" | "merged";
    samePhone?: boolean;
    sameEmail?: boolean;
    sameNameAddress?: boolean;
  },
): DuplicateGroup[] {
  return groups.filter((g) => {
    if (filter.confidence === "ignored") return !!g.suppressed;
    if (filter.confidence === "merged") return !!g.merged;
    if (filter.confidence && filter.confidence !== "all" && g.confidence !== filter.confidence) {
      return false;
    }
    if (g.suppressed) return false;
    if (filter.samePhone && !g.reasons.some((r) => r === "phone" || r === "phone_name")) {
      return false;
    }
    if (filter.sameEmail && !g.reasons.some((r) => r === "email" || r === "email_name")) {
      return false;
    }
    if (filter.sameNameAddress && !g.reasons.includes("name_address")) {
      return false;
    }
    return true;
  });
}

export function conflictingProfileFields(
  survivor: CleanupCustomer,
  duplicate: CleanupCustomer,
): ProfileMergeField[] {
  const out: ProfileMergeField[] = [];
  for (const field of PROFILE_MERGE_FIELDS) {
    const a = (survivor[field] ?? "").toString().trim();
    const b = (duplicate[field] ?? "").toString().trim();
    if (a && b && a !== b) out.push(field);
  }
  return out;
}

export function resolveChosenProfile(
  survivor: CleanupCustomer,
  duplicate: CleanupCustomer,
  chosen: ChosenProfileFields,
): { ok: true; profile: CleanupCustomer } | { ok: false; missing: ProfileMergeField[] } {
  const missing = conflictingProfileFields(survivor, duplicate).filter(
    (f) => chosen[f] !== "survivor" && chosen[f] !== "duplicate",
  );
  if (missing.length) return { ok: false, missing };
  const profile: CleanupCustomer = { ...survivor };
  for (const field of PROFILE_MERGE_FIELDS) {
    const pick = chosen[field];
    const fromDup = duplicate[field];
    const fromSur = survivor[field];
    if (pick === "duplicate") {
      (profile as Record<string, unknown>)[field] = fromDup ?? fromSur;
    } else if (pick === "survivor") {
      (profile as Record<string, unknown>)[field] = fromSur ?? fromDup;
    } else if (!(fromSur ?? "").toString().trim() && (fromDup ?? "").toString().trim()) {
      (profile as Record<string, unknown>)[field] = fromDup;
    }
  }
  return { ok: true, profile };
}

export function authorizeMerge(role: string): MergeDecision {
  if (!mayMergeCustomers(role)) {
    return {
      ok: false,
      code: "NOT_AUTHORIZED",
      error: "Only office/admin can merge customer records.",
    };
  }
  return { ok: true };
}

export function authorizeDuplicateReview(role: string): MergeDecision {
  if (!mayViewDuplicateReview(role)) {
    return {
      ok: false,
      code: "NOT_AUTHORIZED",
      error: "Duplicate review is limited to office, admin, and sales managers.",
    };
  }
  return { ok: true };
}

export function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function snapshotFinancials(invoices: JobBalanceInvoiceInput[]): FinancialSnapshot {
  const open = computeJobOpenBalance(invoices);
  let invoiceTotal = 0;
  let payments = 0;
  let credits = 0;
  let deposits = 0;
  let writeOffs = 0;
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const items = inv.items ?? [];
    const tax = Number(inv.tax_rate) || 0;
    const sub = items.reduce(
      (s, i) => s + (Number(i.quantity) || 0) * (Number(i.rate) || 0),
      0,
    );
    invoiceTotal += sub + sub * (tax / 100);
    if (inv.amountPaid !== undefined && inv.amountPaid !== null && inv.amountPaid !== "") {
      payments += Number(inv.amountPaid) || 0;
    } else {
      payments += (inv.payments ?? [])
        .filter((p) => (p.status ?? "active") !== "void")
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    }
    if (
      inv.appliedCredits !== undefined &&
      inv.appliedCredits !== null &&
      inv.appliedCredits !== ""
    ) {
      credits += Number(inv.appliedCredits) || 0;
    } else {
      credits += (inv.creditApplications ?? [])
        .filter((c) => (c.status ?? "active") !== "void")
        .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    }
    deposits += Number(inv.appliedDeposits) || 0;
    writeOffs += Number(inv.appliedWriteOffs) || 0;
  }
  return {
    invoiceTotal: roundMoney(invoiceTotal),
    payments: roundMoney(payments),
    creditApplications: roundMoney(credits),
    depositApplications: roundMoney(deposits),
    writeOffs: roundMoney(writeOffs),
    openAr: roundMoney(open.balance),
    depositBalances: 0,
    refunds: 0,
  };
}

export function financialsUnchanged(
  before: FinancialSnapshot,
  after: FinancialSnapshot,
): boolean {
  const keys: (keyof FinancialSnapshot)[] = [
    "invoiceTotal",
    "payments",
    "creditApplications",
    "depositApplications",
    "writeOffs",
    "openAr",
    "depositBalances",
    "refunds",
  ];
  return keys.every((k) => roundMoney(before[k]) === roundMoney(after[k]));
}

export function mergeIdempotencyKey(
  survivorId: string,
  duplicateId: string,
): string {
  return `merge-customer:${survivorId}:${duplicateId}`;
}

export type MergeRecord<T extends { customer_id?: string | null; for_customer_id?: string | null }> = T;

export type InMemoryMergeState = {
  customers: CleanupCustomer[];
  jobs: { id: string; customer_id: string; delivery_type?: string | null; status?: string | null }[];
  estimates: { id: string; customer_id: string }[];
  invoices: (JobBalanceInvoiceInput & { customer_id: string; counter_sale?: boolean })[];
  deposits: {
    id: string;
    customer_id: string;
    job_id: string | null;
    estimate_id: string | null;
    amount: number;
    unapplied: number;
  }[];
  creditMemos: { id: string; customer_id: string; amount: number }[];
  refunds: { id: string; customer_id: string; amount: number }[];
  writeOffs: { id: string; invoice_id: string; amount: number }[];
  orders: { id: string; customer_id: string }[];
  appointments: { id: string; customer_id: string }[];
  documents: { id: string; customer_id: string; path: string }[];
  notes: { id: string; customer_id: string; body: string }[];
  portalProfiles: { id: string; customer_id: string; role: string }[];
  estimateDrafts: { customer_id: string }[];
  exclusions: ExclusionPair[];
  mergeHistory: {
    survivor_customer_id: string;
    duplicate_customer_id: string;
    performed_by: string;
    performed_at: string;
    reason: string;
    chosen_fields: ChosenProfileFields;
    pre_merge_counts: MergeMoveCounts;
    idempotency_key: string;
  }[];
  locks: Set<string>;
  accountingPostings: number;
  accountingEnabled: boolean;
};

function reassign<T extends { customer_id?: string | null; for_customer_id?: string | null }>(
  rows: T[],
  from: string,
  to: string,
  column: "customer_id" | "for_customer_id" = "customer_id",
): T[] {
  return rows.map((r) =>
    r[column] === from ? { ...r, [column]: to } : r,
  );
}

export function countMoves(
  state: InMemoryMergeState,
  fromId: string,
): MergeMoveCounts {
  const jobs = state.jobs.filter((j) => j.customer_id === fromId);
  const invoices = state.invoices.filter((i) => i.customer_id === fromId);
  const openAr = snapshotFinancials(invoices).openAr;
  return {
    jobs: jobs.length,
    estimates: state.estimates.filter((e) => e.customer_id === fromId).length,
    invoices: invoices.length,
    payments: invoices.reduce(
      (s, i) => s + (i.payments?.length ?? 0),
      0,
    ),
    credits: state.creditMemos.filter((c) => c.customer_id === fromId).length,
    deposits: state.deposits.filter((d) => d.customer_id === fromId).length,
    writeOffs: invoices.reduce((s, i) => s + (Number(i.appliedWriteOffs) ? 1 : 0), 0),
    refunds: state.refunds.filter((r) => r.customer_id === fromId).length,
    cashAndCarry: jobs.filter((j) => j.delivery_type === "cash_carry").length +
      invoices.filter((i) => i.counter_sale).length,
    orders: state.orders.filter((o) => o.customer_id === fromId).length,
    appointments: state.appointments.filter((a) => a.customer_id === fromId).length,
    documents: state.documents.filter((d) => d.customer_id === fromId).length,
    notes: state.notes.filter((n) => n.customer_id === fromId).length,
    openAr,
  };
}

export function previewMerge(args: {
  state: InMemoryMergeState;
  survivorId: string;
  duplicateId: string;
}): {
  counts: MergeMoveCounts;
  combinedFinancials: FinancialSnapshot;
  depositRestrictionsPreserved: true;
} {
  const from = args.duplicateId;
  const invoices = args.state.invoices.filter(
    (i) => i.customer_id === args.survivorId || i.customer_id === from,
  );
  const deposits = args.state.deposits.filter(
    (d) => d.customer_id === args.survivorId || d.customer_id === from,
  );
  const snap = snapshotFinancials(invoices);
  snap.depositBalances = roundMoney(deposits.reduce((s, d) => s + d.unapplied, 0));
  snap.refunds = roundMoney(
    args.state.refunds
      .filter((r) => r.customer_id === args.survivorId || r.customer_id === from)
      .reduce((s, r) => s + r.amount, 0),
  );
  return {
    counts: countMoves(args.state, from),
    combinedFinancials: snap,
    depositRestrictionsPreserved: true,
  };
}

export function executeCustomerMerge(args: {
  state: InMemoryMergeState;
  survivorId: string;
  duplicateId: string;
  chosen: ChosenProfileFields;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  actorRole: string;
}): { ok: true; state: InMemoryMergeState; duplicate: boolean } | { ok: false; code: MergeBlockCode; error: string } {
  const auth = authorizeMerge(args.actorRole);
  if (!auth.ok) return auth;
  if (!(args.reason ?? "").trim()) {
    return { ok: false, code: "MISSING_REASON", error: "A merge reason is required." };
  }
  if (args.survivorId === args.duplicateId) {
    return { ok: false, code: "SAME_CUSTOMER", error: "Cannot merge a customer into itself." };
  }

  const prior = args.state.mergeHistory.find(
    (h) => h.idempotency_key === args.idempotencyKey,
  );
  if (prior) {
    if (
      prior.survivor_customer_id === args.survivorId &&
      prior.duplicate_customer_id === args.duplicateId
    ) {
      return { ok: true, state: args.state, duplicate: true };
    }
    return {
      ok: false,
      code: "IDEMPOTENCY_CONFLICT",
      error: "This idempotency key was already used for a different merge.",
    };
  }

  const lockIds = [args.survivorId, args.duplicateId].sort();
  for (const id of lockIds) {
    if (args.state.locks.has(id)) {
      return {
        ok: false,
        code: "MERGE_IN_PROGRESS",
        error: "Another merge is already running for one of these customers.",
      };
    }
  }
  for (const id of lockIds) args.state.locks.add(id);

  try {
    const survivor = args.state.customers.find((c) => c.id === args.survivorId);
    const duplicate = args.state.customers.find((c) => c.id === args.duplicateId);
    if (!survivor || !duplicate) {
      return { ok: false, code: "NOT_FOUND", error: "Customer not found." };
    }
    if (isMergedAway(survivor)) {
      return {
        ok: false,
        code: "SURVIVOR_MERGED",
        error: "The surviving customer was already merged into another record.",
      };
    }
    if (isMergedAway(duplicate)) {
      return {
        ok: false,
        code: "DUPLICATE_MERGED",
        error: "That customer was already merged and cannot be merged again.",
      };
    }

    const portalA = args.state.portalProfiles.filter(
      (p) => p.customer_id === args.survivorId && p.role === "customer",
    );
    const portalB = args.state.portalProfiles.filter(
      (p) => p.customer_id === args.duplicateId && p.role === "customer",
    );
    if (portalA.length && portalB.length) {
      return {
        ok: false,
        code: "PORTAL_CONFLICT",
        error: "Both records have customer portal logins. Resolve portal identity before merging.",
      };
    }
    const draftA = args.state.estimateDrafts.some((d) => d.customer_id === args.survivorId);
    const draftB = args.state.estimateDrafts.some((d) => d.customer_id === args.duplicateId);
    if (draftA && draftB) {
      return {
        ok: false,
        code: "DRAFT_CONFLICT",
        error: "Both records have an in-progress estimate draft. Resolve drafts before merging.",
      };
    }

    const resolved = resolveChosenProfile(survivor, duplicate, args.chosen);
    if (!resolved.ok) {
      return {
        ok: false,
        code: "FIELD_CONFLICT",
        error: `Choose a surviving value for: ${resolved.missing.join(", ")}.`,
      };
    }

    const before = previewMerge({
      state: args.state,
      survivorId: args.survivorId,
      duplicateId: args.duplicateId,
    });
    const counts = before.counts;
    const now = new Date().toISOString();

    const next: InMemoryMergeState = {
      ...args.state,
      customers: args.state.customers.map((c) => {
        if (c.id === args.duplicateId) {
          return {
            ...c,
            merged_into_customer_id: args.survivorId,
            merged_at: now,
            merged_by: args.actorId,
            merge_reason: args.reason.trim(),
          };
        }
        if (c.id === args.survivorId) {
          return { ...resolved.profile, id: args.survivorId };
        }
        return c;
      }),
      jobs: reassign(args.state.jobs, args.duplicateId, args.survivorId),
      estimates: reassign(args.state.estimates, args.duplicateId, args.survivorId),
      invoices: reassign(args.state.invoices, args.duplicateId, args.survivorId),
      deposits: args.state.deposits.map((d) =>
        d.customer_id === args.duplicateId
          ? { ...d, customer_id: args.survivorId }
          : d,
      ),
      creditMemos: reassign(args.state.creditMemos, args.duplicateId, args.survivorId),
      refunds: reassign(args.state.refunds, args.duplicateId, args.survivorId),
      writeOffs: args.state.writeOffs,
      orders: reassign(args.state.orders, args.duplicateId, args.survivorId),
      appointments: reassign(args.state.appointments, args.duplicateId, args.survivorId),
      documents: reassign(args.state.documents, args.duplicateId, args.survivorId),
      notes: [
        ...reassign(args.state.notes, args.duplicateId, args.survivorId),
        {
          id: `merge-${args.idempotencyKey}`,
          customer_id: args.survivorId,
          body: `Customer record ${args.duplicateId} merged into this customer on ${now} by ${args.actorId}.`,
        },
      ],
      portalProfiles: args.state.portalProfiles.map((p) =>
        p.customer_id === args.duplicateId
          ? { ...p, customer_id: args.survivorId }
          : p,
      ),
      estimateDrafts: args.state.estimateDrafts.map((d) =>
        d.customer_id === args.duplicateId
          ? { ...d, customer_id: args.survivorId }
          : d,
      ),
      mergeHistory: [
        ...args.state.mergeHistory,
        {
          survivor_customer_id: args.survivorId,
          duplicate_customer_id: args.duplicateId,
          performed_by: args.actorId,
          performed_at: now,
          reason: args.reason.trim(),
          chosen_fields: args.chosen,
          pre_merge_counts: counts,
          idempotency_key: args.idempotencyKey,
        },
      ],
      accountingPostings: args.state.accountingPostings,
      accountingEnabled: false,
    };

    const afterInvoices = next.invoices.filter((i) => i.customer_id === args.survivorId);
    const afterSnap = snapshotFinancials(afterInvoices);
    afterSnap.depositBalances = roundMoney(
      next.deposits
        .filter((d) => d.customer_id === args.survivorId)
        .reduce((s, d) => s + d.unapplied, 0),
    );
    afterSnap.refunds = roundMoney(
      next.refunds
        .filter((r) => r.customer_id === args.survivorId)
        .reduce((s, r) => s + r.amount, 0),
    );
    if (!financialsUnchanged(before.combinedFinancials, afterSnap)) {
      throw new Error("FINANCIAL_DRIFT");
    }

    return { ok: true, state: next, duplicate: false };
  } finally {
    for (const id of lockIds) args.state.locks.delete(id);
  }
}

export function hideMergedCustomers<T extends { merged_into_customer_id?: string | null }>(
  rows: T[],
): T[] {
  return rows.filter((r) => !r.merged_into_customer_id);
}

export function activeCustomerSearchHits<T extends CleanupCustomer>(
  rows: T[],
): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const canonical = canonicalCustomerId(row);
    if (seen.has(canonical)) continue;
    const live = byId.get(canonical);
    if (!live || isMergedAway(live)) continue;
    seen.add(canonical);
    out.push(live);
  }
  return out;
}

export const MERGE_LIVE_TABLES = MERGE_SQL_TABLES;

export function depositRestrictionsIntact(
  before: InMemoryMergeState["deposits"],
  after: InMemoryMergeState["deposits"],
): boolean {
  const byId = new Map(after.map((d) => [d.id, d]));
  for (const d of before) {
    const n = byId.get(d.id);
    if (!n) return false;
    if (n.job_id !== d.job_id) return false;
    if (n.estimate_id !== d.estimate_id) return false;
    if (n.amount !== d.amount) return false;
    if (n.unapplied !== d.unapplied) return false;
  }
  return true;
}

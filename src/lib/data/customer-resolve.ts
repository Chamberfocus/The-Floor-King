/**
 * Server helper: RLS-scoped customer match + resolve-or-create.
 * Staff matching uses the user session so salesman ACL cannot be bypassed.
 * Public booking uses the admin client and never returns match details.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import {
  classifyImportRows,
  decidePublicBooking,
  decideStaffCreate,
  filterMatchesForActor,
  findPotentialCustomerMatches,
  recheckBeforeInsert,
  summarizeImport,
  type ClassifiedImportRow,
  type MatchCandidateInput,
  type MatchableCustomer,
  type ScoredCustomerMatch,
} from "@/lib/customer-resolve";
import { normalizeEmail, normalizePhoneDigits } from "@/lib/customer-duplicate";

const MATCH_COLS =
  "id, full_name, email, phone, city, street, state, zip, company, assigned_to, workflow_owner_id";

type Q = {
  select: (cols: string) => Q;
  ilike: (col: string, val: string) => Q;
  in: (col: string, vals: string[]) => Q;
  eq: (col: string, val: string) => Q;
  limit: (n: number) => Q;
  single: () => PromiseLike<{
    data: { id: string } | null;
    error: { message: string } | null;
  }>;
} & PromiseLike<{ data: unknown }>;

type Loose = {
  from: (table: string) => {
    select: (cols: string) => Q;
    insert: (row: Record<string, unknown>) => Q;
  };
};

function likeSafe(term: string): string {
  return term.replace(/[%_,]/g, " ").trim();
}

function asRow(r: Record<string, unknown>): MatchableCustomer {
  return {
    id: String(r.id),
    full_name: String(r.full_name ?? ""),
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    address: (r.street as string) ?? null,
    street: (r.street as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    zip: (r.zip as string) ?? null,
    company: (r.company as string) ?? null,
    assigned_to: (r.assigned_to as string) ?? null,
    workflow_owner_id: (r.workflow_owner_id as string) ?? null,
  };
}

async function loadPool(
  db: Loose,
  input: MatchCandidateInput,
): Promise<MatchableCustomer[]> {
  const byId = new Map<string, MatchableCustomer>();
  const add = (rows: unknown) => {
    for (const r of (rows as Record<string, unknown>[] | null) ?? []) {
      const row = asRow(r);
      if (row.id) byId.set(row.id, row);
    }
  };

  const jobs: Promise<void>[] = [];
  const email = normalizeEmail(input.email);
  const phone = normalizePhoneDigits(input.phone);
  const name = likeSafe(input.fullName ?? "");

  if (email) {
    jobs.push(
      (async () => {
        const { data } = await db
          .from("customers")
          .select(MATCH_COLS)
          .ilike("email", email)
          .limit(20);
        add(data);
      })(),
    );
  }
  if (name) {
    jobs.push(
      (async () => {
        const { data } = await db
          .from("customers")
          .select(MATCH_COLS)
          .ilike("full_name", name)
          .limit(25);
        add(data);
      })(),
    );
  }
  if (phone.length >= 4) {
    jobs.push(
      (async () => {
        const { data } = await db
          .from("customers")
          .select(MATCH_COLS)
          .ilike("phone", `%${phone.slice(-4)}`)
          .limit(50);
        add(data);
      })(),
    );
  }

  await Promise.all(jobs);

  const ids = [...byId.keys()];
  if (ids.length) {
    const { data: jobRows } = await db
      .from("jobs")
      .select("customer_id")
      .in("customer_id", ids);
    const counts = new Map<string, number>();
    for (const j of (jobRows as { customer_id: string }[] | null) ?? []) {
      counts.set(j.customer_id, (counts.get(j.customer_id) ?? 0) + 1);
    }
    for (const [id, row] of byId) {
      row.jobCount = counts.get(id) ?? 0;
    }
  }

  return [...byId.values()];
}

export async function findStaffCustomerMatches(
  input: MatchCandidateInput,
): Promise<ScoredCustomerMatch[]> {
  const profile = await requireProfile();
  const supabase = (await createClient()) as unknown as Loose;
  const pool = await loadPool(supabase, input);
  const scored = findPotentialCustomerMatches(input, pool);
  return filterMatchesForActor(scored, { role: profile.role, id: profile.id });
}

export type ResolveOrCreateResult =
  | { action: "use_existing"; customerId: string }
  | { action: "created"; customerId: string }
  | { action: "needs_choice"; matches: ScoredCustomerMatch[] }
  | { action: "error"; error: string };

export async function resolveOrCreateCustomer(args: {
  input: MatchCandidateInput;
  insert: Record<string, unknown>;
  useExistingId?: string | null;
  forceCreate?: boolean;
  overrideReason?: string | null;
}): Promise<ResolveOrCreateResult> {
  const profile = await requireProfile();
  const supabase = (await createClient()) as unknown as Loose;

  const existingId = (args.useExistingId ?? "").trim();
  if (existingId) {
    const { data } = await supabase
      .from("customers")
      .select("id")
      .eq("id", existingId);
    const hit = (data as { id: string }[] | null)?.[0];
    if (!hit) return { action: "error", error: "That customer is not available." };
    return { action: "use_existing", customerId: hit.id };
  }

  const pool = await loadPool(supabase, args.input);
  const matches = filterMatchesForActor(
    findPotentialCustomerMatches(args.input, pool),
    { role: profile.role, id: profile.id },
  );

  const decision = decideStaffCreate({
    input: args.input,
    matches,
    forceCreate: args.forceCreate,
    overrideReason: args.overrideReason,
    actorRole: profile.role,
  });
  if (decision.action === "needs_choice") {
    return { action: "needs_choice", matches: decision.matches };
  }
  if (decision.action === "blocked") {
    return { action: "error", error: decision.error };
  }
  if (decision.action === "use_existing") {
    return { action: "use_existing", customerId: decision.customerId };
  }

  const latestPool = await loadPool(supabase, args.input);
  const latest = filterMatchesForActor(
    findPotentialCustomerMatches(args.input, latestPool),
    { role: profile.role, id: profile.id },
  );
  const recheck = recheckBeforeInsert({
    latest,
    forceCreate: args.forceCreate,
  });
  if (!recheck.ok) {
    return { action: "needs_choice", matches: recheck.matches };
  }

  const { data, error } = await supabase
    .from("customers")
    .insert(args.insert)
    .select("id")
    .single();
  if (error || !data) {
    return { action: "error", error: error?.message ?? "Couldn't save the customer." };
  }
  return { action: "created", customerId: data.id };
}

export async function resolvePublicBookingCustomer(input: {
  name: string;
  phone: string;
  email: string;
}): Promise<{ customerId: string | null; created: boolean; error: string | null }> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return {
      customerId: null,
      created: false,
      error: "Booking is temporarily unavailable.",
    };
  }
  const db = admin as unknown as Loose;
  const matchInput: MatchCandidateInput = {
    fullName: input.name,
    phone: input.phone || null,
    email: input.email || null,
  };
  const pool = await loadPool(db, matchInput);
  const matches = findPotentialCustomerMatches(matchInput, pool);
  const decision = decidePublicBooking(matches);

  if (decision.action === "link_existing") {
    return { customerId: decision.customerId, created: false, error: null };
  }

  const notes = decision.needsStaffReview
    ? "Website booking — possible existing customer; staff review (do not auto-merge)."
    : null;

  const { data, error } = await db
    .from("customers")
    .insert({
      full_name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      stage: "new",
      source: "website",
      notes,
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      customerId: null,
      created: false,
      error: error?.message || "Couldn't submit your request.",
    };
  }
  return { customerId: data.id, created: true, error: null };
}

export async function previewCustomerImport(
  rows: MatchCandidateInput[],
): Promise<{
  classified: ClassifiedImportRow[];
  summary: ReturnType<typeof summarizeImport>;
}> {
  await requireProfile();
  const supabase = (await createClient()) as unknown as Loose;
  const existing: MatchableCustomer[] = [];
  const { data } = await supabase
    .from("customers")
    .select(MATCH_COLS)
    .limit(5000);
  for (const r of (data as Record<string, unknown>[] | null) ?? []) {
    existing.push(asRow(r));
  }
  const classified = classifyImportRows(rows, existing);
  return { classified, summary: summarizeImport(classified) };
}

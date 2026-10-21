import { createClient } from "@/lib/supabase/server";
import {
  buildSaleFocus,
  chooseSaleFocus,
  compareSaleCandidates,
  type SaleCandidate,
  type SaleEstimateRef,
  type SaleInvoiceRef,
} from "@/lib/sale-focus";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SaleFocusOther {
  id: string;
  name: string;
  city: string | null;
  stepTitle: string;
}

export interface SaleFocusBoard {
  greeting: string;
  focus: SaleCandidate | null;
  others: SaleFocusOther[];
  unavailable: boolean;
}

type CustomerRow = {
  id: string;
  full_name: string;
  city: string | null;
  next_action_due: string | null;
  created_at: string;
};

function pickVisit(
  rows: { starts_at: string; kind: string | null; is_block: boolean | null }[],
  now: Date,
): string | null {
  const live = rows.filter((row) => row.kind !== "block" && !row.is_block && row.starts_at);
  if (!live.length) return null;
  const nowIso = now.toISOString();
  const upcoming = live
    .filter((row) => row.starts_at >= nowIso)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (upcoming[0]) return upcoming[0].starts_at;
  return [...live].sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0].starts_at;
}

export async function loadSaleFocusBoard(args: {
  userId: string;
  firstName: string;
  pinnedId: string | null;
}): Promise<SaleFocusBoard> {
  const greeting = `Hello, ${args.firstName}`;
  const empty: SaleFocusBoard = {
    greeting,
    focus: null,
    others: [],
    unavailable: false,
  };
  if (!UUID.test(args.userId)) return { ...empty, unavailable: true };

  const db = await createClient();
  const pinned = args.pinnedId && UUID.test(args.pinnedId) ? args.pinnedId : null;
  const owned = `assigned_to.eq.${args.userId},workflow_owner_id.eq.${args.userId}`;
  const { data, error } = await db
    .from("customers")
    .select("id, full_name, city, next_action_due, created_at")
    .or(owned)
    .is("cancelled_at", null)
    .order("next_action_due", { ascending: true, nullsFirst: false })
    .limit(40);
  if (error) return { ...empty, unavailable: true };

  let rows = (data ?? []) as CustomerRow[];
  if (pinned && !rows.some((row) => row.id === pinned)) {
    const extra = await db
      .from("customers")
      .select("id, full_name, city, next_action_due, created_at")
      .eq("id", pinned)
      .or(owned)
      .is("cancelled_at", null)
      .maybeSingle();
    if (extra.data) rows = [...rows, extra.data as CustomerRow];
  }
  if (!rows.length) return empty;

  const ids = rows.map((row) => row.id);
  const [appointments, estimates, invoices, deposits] = await Promise.all([
    db
      .from("appointments")
      .select("customer_id, starts_at, kind, is_block")
      .in("customer_id", ids)
      .eq("status", "scheduled"),
    db
      .from("estimates")
      .select("id, customer_id, status, updated_at, created_at, approval_stale")
      .in("customer_id", ids),
    db
      .from("invoices")
      .select("id, customer_id, estimate_id, status, payments(amount, status)")
      .in("customer_id", ids),
    db.from("customer_deposits").select("customer_id, amount, status").in("customer_id", ids),
  ]);
  if (appointments.error || estimates.error || invoices.error) {
    return { ...empty, unavailable: true };
  }

  const now = new Date();
  const apptRows = (appointments.data ?? []) as {
    customer_id: string;
    starts_at: string;
    kind: string | null;
    is_block: boolean | null;
  }[];
  const estimateRows = (estimates.data ?? []) as {
    id: string;
    customer_id: string;
    status: string;
    updated_at: string | null;
    created_at: string | null;
    approval_stale: boolean | null;
  }[];
  const invoiceRows = (invoices.data ?? []) as {
    id: string;
    customer_id: string;
    estimate_id: string | null;
    status: string | null;
    payments: { amount: number | null; status: string | null }[] | null;
  }[];
  const depositRows = (deposits.error ? [] : deposits.data ?? []) as {
    customer_id: string;
    amount: number | null;
    status: string | null;
  }[];

  const candidates: SaleCandidate[] = rows.map((row) => {
    const visitAt = pickVisit(
      apptRows.filter((appt) => appt.customer_id === row.id),
      now,
    );
    const estimateRefs: SaleEstimateRef[] = estimateRows
      .filter((estimate) => estimate.customer_id === row.id)
      .map((estimate) => ({
        id: estimate.id,
        status: estimate.status,
        updatedAt: estimate.updated_at ?? estimate.created_at,
        approvalStale: estimate.approval_stale,
      }));
    const invoiceRefs: SaleInvoiceRef[] = invoiceRows
      .filter((invoice) => invoice.customer_id === row.id)
      .map((invoice) => ({
        id: invoice.id,
        status: invoice.status,
        estimateId: invoice.estimate_id,
        payments: (invoice.payments ?? []).map((payment) => ({
          amount: Number(payment.amount) || 0,
          status: payment.status,
        })),
      }));
    const depositOnFile = depositRows.some(
      (deposit) =>
        deposit.customer_id === row.id &&
        deposit.status !== "void" &&
        (Number(deposit.amount) || 0) > 0,
    );
    return {
      id: row.id,
      name: row.full_name,
      city: row.city,
      nextActionDue: row.next_action_due,
      createdAt: row.created_at,
      visitAt,
      path: buildSaleFocus({
        customerId: row.id,
        now,
        visitAt,
        depositOnFile,
        estimates: estimateRefs,
        invoices: invoiceRefs,
      }),
    };
  });

  const focus = chooseSaleFocus(candidates, pinned, now);
  const others = candidates
    .filter((row) => row.id !== focus?.id && !row.path.handedOff && row.path.move)
    .sort((a, b) => compareSaleCandidates(a, b, now))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      stepTitle: row.path.move?.title ?? "This sale",
    }));

  return { greeting, focus, others, unavailable: false };
}

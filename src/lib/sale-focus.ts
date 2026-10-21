import { STEP_TITLES, type FlowStep } from "@/lib/job-flow";
import { shopTodayYmd } from "@/lib/job-snapshot";

/**
 * The salesman's sale, read from the records that already exist.
 * Nothing here is stored. The pin cookie only remembers which customer
 * they are with; the step comes from the visit, the quote, and the deposit.
 */

export const SALE_FOCUS_COOKIE = "fk_sale_customer";
export const SALE_FOCUS_NAME_COOKIE = "fk_sale_customer_name";

export const SALE_STEPS = [
  "schedule_estimate",
  "estimate_booked",
  "build_quote",
  "approve",
  "collect_deposit",
] as const satisfies readonly FlowStep[];

export type SaleStep = (typeof SALE_STEPS)[number];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SaleEstimateRef {
  id: string;
  status: string;
  updatedAt?: string | null;
  approvalStale?: boolean | null;
}

export interface SalePaymentRef {
  amount: number;
  status?: string | null;
}

export interface SaleInvoiceRef {
  id: string;
  status?: string | null;
  estimateId?: string | null;
  payments?: SalePaymentRef[];
}

export interface SaleFocusInput {
  customerId: string;
  now?: Date;
  visitAt?: string | null;
  /** A deposit ledger row already holds money for this customer. */
  depositOnFile?: boolean;
  estimates?: SaleEstimateRef[];
  invoices?: SaleInvoiceRef[];
}

export interface SaleStepView {
  step: SaleStep;
  title: string;
  state: "done" | "current" | "later";
}

export interface SaleMove {
  step: SaleStep;
  title: string;
  label: string;
  href: string;
  detail: string;
}

export interface SaleFocus {
  steps: SaleStepView[];
  move: SaleMove | null;
  handedOff: boolean;
}

export interface SaleCandidate {
  id: string;
  name: string;
  city: string | null;
  nextActionDue: string | null;
  createdAt: string;
  visitAt: string | null;
  path: SaleFocus;
}

function liveEstimate(row: SaleEstimateRef): boolean {
  return (
    row.status === "draft" ||
    row.status === "sent" ||
    row.status === "approved" ||
    row.status === "changes_requested"
  );
}

function approvedNow(row: SaleEstimateRef): boolean {
  return row.status === "approved" && !row.approvalStale;
}

function quoteWasSent(row: SaleEstimateRef): boolean {
  return row.status === "sent" || approvedNow(row);
}

function paymentRecorded(invoices: SaleInvoiceRef[]): boolean {
  return invoices.some(
    (invoice) =>
      invoice.status !== "void" &&
      (invoice.payments ?? []).some(
        (payment) =>
          (payment.status ?? "active") !== "void" && Number(payment.amount) > 0,
      ),
  );
}

function newest(rows: SaleEstimateRef[]): SaleEstimateRef | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const byTime = (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    if (byTime !== 0) return byTime;
    return b.id.localeCompare(a.id);
  })[0];
}

function stepDone(step: SaleStep, input: SaleFocusInput, estimates: SaleEstimateRef[]): boolean {
  const live = estimates.filter(liveEstimate);
  switch (step) {
    case "schedule_estimate":
      return !!input.visitAt || live.length > 0;
    case "estimate_booked":
      return live.length > 0;
    case "build_quote":
      return live.some(quoteWasSent);
    case "approve":
      return live.some(approvedNow);
    case "collect_deposit":
      return input.depositOnFile === true || paymentRecorded(input.invoices ?? []);
    default:
      return false;
  }
}

function moveFor(step: SaleStep, input: SaleFocusInput, estimates: SaleEstimateRef[], now: Date): SaleMove {
  const title = STEP_TITLES[step];
  const id = input.customerId;
  const live = estimates.filter(liveEstimate);

  if (step === "schedule_estimate") {
    return {
      step,
      title,
      label: "Book the visit",
      href: `/customers/${id}?schedule=estimate`,
      detail: "Put this customer on the calendar so the measure stays with you.",
    };
  }

  if (step === "estimate_booked") {
    const visit = input.visitAt ? new Date(input.visitAt) : null;
    const upcoming = !!visit && Number.isFinite(visit.getTime()) && visit.getTime() > now.getTime();
    if (upcoming) {
      return {
        step,
        title,
        label: "Open the visit",
        href: `/customers/${id}?schedule=estimate`,
        detail: "The visit is set. Stay with this customer through the quote.",
      };
    }
    return {
      step,
      title,
      label: "Build the quote",
      href: `/estimates/guided?customer=${id}`,
      detail: "Price this job while you are with the customer.",
    };
  }

  if (step === "build_quote") {
    const draft = newest(
      live.filter(
        (row) =>
          row.status === "draft" ||
          row.status === "changes_requested" ||
          (row.status === "approved" && row.approvalStale),
      ),
    );
    if (draft) {
      return {
        step,
        title,
        label: "Open the quote",
        href: `/estimates/${draft.id}`,
        detail: "Finish this quote and send it while you are with this customer.",
      };
    }
    return {
      step,
      title,
      label: "Build the quote",
      href: `/estimates/guided?customer=${id}`,
      detail: "Build the quote for this customer and send it.",
    };
  }

  if (step === "approve") {
    const sent = newest(live.filter((row) => row.status === "sent"));
    return {
      step,
      title,
      label: "Open the quote",
      href: sent ? `/estimates/${sent.id}` : `/customers/${id}#estimates`,
      detail: "Get a yes on this quote, then take the deposit.",
    };
  }

  const approved = newest(live.filter(approvedNow));
  const openInvoices = (input.invoices ?? []).filter(
    (invoice) => invoice.status !== "void" && invoice.status !== "paid" && invoice.id,
  );
  const linked = approved
    ? openInvoices.find((invoice) => invoice.estimateId === approved.id)
    : null;
  const invoice = linked ?? openInvoices[0] ?? null;
  if (invoice) {
    return {
      step,
      title,
      label: "Collect the deposit",
      href: `/invoices/${invoice.id}`,
      detail: "Record the deposit on this customer's invoice.",
    };
  }
  if (approved) {
    return {
      step,
      title,
      label: "Invoice the deposit",
      href: `/estimates/${approved.id}/invoice`,
      detail: "Turn the approved quote into the deposit invoice.",
    };
  }
  return {
    step,
    title,
    label: "Collect the deposit",
    href: `/customers/${id}#invoices`,
    detail: "Record the deposit so this sale can move to the shop.",
  };
}

export function buildSaleFocus(input: SaleFocusInput): SaleFocus {
  const now = input.now ?? new Date();
  const estimates = input.estimates ?? [];
  let current: SaleStep | null = null;
  const steps: SaleStepView[] = SALE_STEPS.map((step) => {
    const done = stepDone(step, input, estimates);
    if (!done && !current) current = step;
    return {
      step,
      title: STEP_TITLES[step],
      state: done ? "done" : "later",
    };
  });
  if (current) {
    for (const step of steps) {
      if (step.step === current) step.state = "current";
    }
    return {
      steps,
      move: moveFor(current, input, estimates, now),
      handedOff: false,
    };
  }
  return { steps, move: null, handedOff: true };
}

function dayKey(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return shopTodayYmd(date);
}

/** Lower is the customer a free salesman should open first. */
export function saleRank(candidate: SaleCandidate, now: Date): number {
  if (candidate.path.handedOff) return 1000;
  const today = shopTodayYmd(now);
  if (dayKey(candidate.visitAt) === today) return 0;
  const step = candidate.path.move?.step;
  const due =
    !!candidate.nextActionDue &&
    new Date(candidate.nextActionDue).getTime() <= now.getTime();
  if (step === "collect_deposit") return 10;
  const visitDay = dayKey(candidate.visitAt);
  if (step === "estimate_booked" && visitDay && visitDay < today) return 20;
  if (step === "build_quote") return due ? 30 : 40;
  if (step === "approve") return due ? 50 : 60;
  if (step === "schedule_estimate") return due ? 70 : 80;
  return 90;
}

export function compareSaleCandidates(a: SaleCandidate, b: SaleCandidate, now: Date): number {
  const rank = saleRank(a, now) - saleRank(b, now);
  if (rank !== 0) return rank;
  const due = (a.nextActionDue ?? "9999").localeCompare(b.nextActionDue ?? "9999");
  if (due !== 0) return due;
  const created = a.createdAt.localeCompare(b.createdAt);
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

/**
 * Stay with the pinned customer. A visit happening today takes the pin,
 * because that customer is the one in front of the salesman.
 */
export function chooseSaleFocus(
  candidates: SaleCandidate[],
  pinnedId: string | null,
  now: Date,
): SaleCandidate | null {
  const open = candidates.filter((row) => !row.path.handedOff);
  if (!open.length) return null;
  const today = shopTodayYmd(now);
  const pinned = pinnedId ? open.find((row) => row.id === pinnedId) ?? null : null;
  if (pinned && dayKey(pinned.visitAt) === today) return pinned;
  const visitToday = open
    .filter((row) => dayKey(row.visitAt) === today)
    .sort((a, b) => (a.visitAt ?? "").localeCompare(b.visitAt ?? ""));
  if (visitToday[0]) return visitToday[0];
  if (pinned) return pinned;
  return [...open].sort((a, b) => compareSaleCandidates(a, b, now))[0] ?? null;
}

function decodeCookie(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface SaleFocusMemory {
  id: string;
  name: string;
}

export function readSaleFocusCookie(jar: {
  get(name: string): { value: string } | undefined;
}): SaleFocusMemory | null {
  const id = decodeCookie(jar.get(SALE_FOCUS_COOKIE)?.value);
  if (!UUID.test(id)) return null;
  const name = decodeCookie(jar.get(SALE_FOCUS_NAME_COOKIE)?.value).trim();
  return { id, name };
}

function writeCookie(name: string, value: string, maxAge: number) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax`;
}

function browserCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const hit = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return decodeCookie(hit?.slice(name.length + 1));
}

export function rememberSaleFocus(id: string, name: string) {
  if (!UUID.test(id)) return;
  const safeName = name.trim().slice(0, 80);
  writeCookie(SALE_FOCUS_COOKIE, encodeURIComponent(id), 60 * 60 * 24 * 30);
  writeCookie(
    SALE_FOCUS_NAME_COOKIE,
    encodeURIComponent(safeName),
    60 * 60 * 24 * 30,
  );
}

/** Drop the pin. When `onlyId` is set, leave a different customer's pin alone. */
export function clearSaleFocus(onlyId?: string) {
  if (typeof document === "undefined") return;
  if (onlyId) {
    const current = browserCookie(SALE_FOCUS_COOKIE);
    if (current && current !== onlyId) return;
  }
  writeCookie(SALE_FOCUS_COOKIE, "", 0);
  writeCookie(SALE_FOCUS_NAME_COOKIE, "", 0);
}

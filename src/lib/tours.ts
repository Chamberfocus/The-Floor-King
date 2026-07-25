// Guided-tour config — the SINGLE source of truth for every walkthrough. Edit
// text/steps here; the engine reads it. Steps point at `data-tour="<target>"`
// attributes on real elements, so a moved/restyled control still resolves by its
// key, and a missing target is skipped (never a crash). Pure data — no React.
import type { UserRole } from "@/lib/types";

export interface TourStep {
  /** data-tour key of the real element to highlight. "" = centered card. */
  target: string;
  /** Route this step lives on (supports [id] and * wildcards). "" = any. */
  route: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "left" | "right";
  /** A static URL "Next" can navigate to (dynamic routes are waited for). */
  href?: string;
}

export interface Tour {
  id: string;
  roles: UserRole[];
  label: string;
  description: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: "sales",
    roles: ["salesman", "sales_manager"],
    label: "Win a job",
    description: "Add a customer, build the estimate, and send it.",
    steps: [
      { target: "", route: "", title: "Win a job in 3 steps",
        body: "This quick tour walks you from a new lead to a sent estimate. You'll do it in the real app — click the highlighted spots. You can skip or exit anytime.",
        placement: "bottom" },
      { target: "add-customer", route: "/customers", href: "/customers/new",
        title: "Add the customer", body: "Start here — add the new lead. Click Add customer (or Next).", placement: "bottom" },
      { target: "customer-form", route: "/customers/new",
        title: "Their details", body: "Enter their name and contact info. Only a name is required — fill the rest as you learn it.", placement: "right" },
      { target: "customer-save", route: "/customers/new",
        title: "Save", body: "Save the customer — you'll land on their file, where the whole job lives.", placement: "top" },
      { target: "build-estimate", route: "/customers/[id]",
        title: "Build the estimate", body: "On the customer's file, click Guided questionnaire to price the job step-by-step.", placement: "bottom" },
      { target: "questionnaire", route: "/estimates/guided",
        title: "Answer the questions", body: "Rooms & areas, carpet & cuts, add-ons — answer along and it builds the estimate (materials + labor) for you.", placement: "top" },
      { target: "estimate-send", route: "/estimates/[id]/edit",
        title: "Send it", body: "Review the lines, then Save & send to email the estimate to the customer. That's a full quote — nice work! 🎉", placement: "top" },
    ],
  },
  {
    id: "installer",
    roles: ["crew"],
    label: "Run your job",
    description: "Open your work order, add photos, get sign-off, collect the balance.",
    steps: [
      { target: "", route: "", title: "Run your job",
        body: "A quick tour of your day: your work order, completion photos, customer sign-off, and collecting the balance. Skip or exit anytime.", placement: "bottom" },
      { target: "my-work", route: "/installer",
        title: "Your work", body: "These are your assigned jobs. Open one to see the work order.", placement: "bottom" },
      { target: "work-order", route: "/jobs/[id]",
        title: "The work order", body: "Everything for the job — scope, rooms, cut sizes, and the schedule.", placement: "top" },
      { target: "job-photos", route: "/jobs/[id]",
        title: "Completion photos", body: "Upload before/after photos here so the office has proof of the finished work.", placement: "top" },
      { target: "satisfaction", route: "/jobs/[id]",
        title: "Customer sign-off", body: "Have the customer confirm they're happy — capture the satisfaction sign-off here.", placement: "top" },
      { target: "collect-balance", route: "/jobs/[id]",
        title: "Collect the balance", body: "If you're set to collect on site, take the final payment here (cash, check, or send a pay link).", placement: "top" },
    ],
  },
  {
    id: "warehouse",
    roles: ["warehouse"],
    label: "Prep a job",
    description: "Read the staging sheet, pull & stage materials, receive a PO.",
    steps: [
      { target: "", route: "", title: "Prep a job",
        body: "How to get a job ready: the staging sheet, pulling & staging materials, and receiving a purchase order into inventory. Skip or exit anytime.", placement: "bottom" },
      { target: "warehouse-queue", route: "/warehouse",
        title: "Your queue", body: "Jobs waiting to be prepped. Open one to see what to pull.", placement: "bottom" },
      { target: "staging-sheet", route: "/warehouse",
        title: "The staging sheet", body: "Print the staging sheet — it lists the products to pull, the carpet cut plan, and pad rolls needed.", placement: "top" },
      { target: "stage-materials", route: "/warehouse",
        title: "Stage it", body: "Once pulled and cut, mark the job staged with its location — that tells the installer it's ready.", placement: "top" },
      { target: "receive-po", route: "/purchase-orders",
        title: "Receive a PO", body: "When a supplier order arrives, open the PO and mark it received to bring the material into inventory.", placement: "bottom" },
    ],
  },
  {
    id: "admin",
    roles: ["admin", "office"],
    label: "Get paid",
    description: "Create an invoice, record a payment, manage customers.",
    steps: [
      { target: "", route: "", title: "Get paid & stay organized",
        body: "The money basics: create an invoice, record a payment, and manage your customers. Skip or exit anytime.", placement: "bottom" },
      { target: "manage-customers", route: "/customers", href: "/customers",
        title: "Your customers", body: "Everyone's here — active, closed, and cancelled. Open a customer to see their whole job.", placement: "bottom" },
      { target: "create-invoice", route: "/customers/[id]",
        title: "Create an invoice", body: "On the customer's file, open the Invoices tab and create an invoice — or build one from the approved estimate.", placement: "top" },
      { target: "record-payment", route: "/invoices/[id]",
        title: "Record a payment", body: "Enter deposits and the final balance here. Paid invoices flow into your revenue and Business Pulse.", placement: "top" },
    ],
  },
];

/** Tours a role can take. */
export function toursForRole(role: UserRole): Tour[] {
  return TOURS.filter((t) => t.roles.includes(role));
}

/** Does a route pattern (with [id] / * wildcards) match a pathname? */
export function routeMatches(pattern: string, path: string): boolean {
  if (!pattern) return true;
  const rx =
    "^" +
    pattern
      .split("/")
      .map((seg) =>
        seg === "*"
          ? "[^/]*"
          : /^\[.+\]$/.test(seg)
            ? "[^/]+"
            : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      .join("/") +
    "$";
  return new RegExp(rx).test(path);
}

/**
 * Operational work queues: which records to show.
 * Next-step copy stays in the Record Action Center.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jobQueueFact } from "@/lib/work-queues";
import {
  MONEY_LIST_ROLES,
  ORDER_LIST_ROLES,
  SERVICE_LIST_ROLES,
  TASK_LIST_ROLES,
  estimateQueueEmpty,
  estimateQueueMine,
  invoiceStatusesForView,
  jobQueueEmpty,
  jobQueueMine,
  listPageWindow,
  orderStatusesForView,
  parseJobQueue,
  parseListPage,
  parseOrderQueue,
  parseServiceQueue,
  parseTaskQueue,
  poStatusesForView,
  resultCountLabel,
  roleSeesMoneyList,
  serviceQueueEmpty,
  serviceQueueStatusLabel,
  serviceStatusesForView,
} from "@/lib/work-queues";
import { phoneSearchPattern } from "@/lib/search-query";

const root = process.cwd();
const src = (path: string) => readFileSync(join(root, path), "utf8");

describe("work queue filters follow canonical facts", () => {
  it("pages orders and keeps review as the default", () => {
    expect(parseOrderQueue(undefined)).toBe("review");
    expect(orderStatusesForView("review")).toEqual(["submitted"]);
    expect(orderStatusesForView("declined")).toEqual(["declined", "cancelled"]);
    expect(orderStatusesForView("all")).toBeNull();
    const window = listPageWindow(2, 40, 90);
    expect(window).toMatchObject({ page: 2, from: 40, to: 80, pages: 3 });
    expect(parseListPage("0")).toBe(1);
    expect(parseListPage("3")).toBe(3);
  });

  it("maps job queues without inventing a status", () => {
    expect(parseJobQueue(undefined, "office")).toBe("open");
    expect(parseJobQueue(undefined, "scheduler")).toBe("ready");
    expect(parseJobQueue("material", "scheduler")).toBe("material");
    expect(jobQueueMine(undefined, "salesman")).toBe(true);
    expect(jobQueueMine("all", "salesman")).toBe(false);
    expect(jobQueueMine(undefined, "office")).toBe(false);
    expect(jobQueueMine(undefined, "crew")).toBe(true);
    expect(jobQueueEmpty("material", false)).toBe("No jobs are waiting for material.");
  });

  it("keeps estimate follow-up on sent estimates and gives sales their own book first", () => {
    expect(estimateQueueMine(undefined, "salesman")).toBe(true);
    expect(estimateQueueMine("all", "salesman")).toBe(false);
    expect(estimateQueueEmpty("followup", false)).toBe("No estimates need follow-up.");
  });

  it("uses invoice status and does not invent a partial-receive PO status", () => {
    expect(invoiceStatusesForView("open")).toEqual(["sent", "partial"]);
    expect(invoiceStatusesForView("overdue")).toEqual(["sent", "partial"]);
    expect(invoiceStatusesForView("paid")).toEqual(["paid"]);
    expect(poStatusesForView("open")).toEqual(["draft", "ordered"]);
    expect(poStatusesForView("received")).toEqual(["received", "closed"]);
    expect(poStatusesForView("all")).toBeNull();
  });

  it("splits service by canonical status and keeps All available", () => {
    expect(parseServiceQueue(undefined)).toBe("open");
    expect(serviceStatusesForView("open")).toEqual(["open", "in_progress", "waiting"]);
    expect(serviceStatusesForView("scheduled")).toEqual(["scheduled"]);
    expect(serviceStatusesForView("completed")).toEqual(["resolved"]);
    expect(serviceStatusesForView("all")).toBeNull();
    expect(serviceQueueStatusLabel("open")).toBe("Service open");
    expect(serviceQueueStatusLabel("resolved")).toBe("Completed");
    expect(serviceQueueEmpty("open", false)).toBe("No open service calls.");
  });

  it("keeps a salesperson on their own tasks", () => {
    expect(parseTaskQueue(undefined, "salesman")).toBe("mine");
    expect(parseTaskQueue("open", "salesman")).toBe("mine");
    expect(parseTaskQueue("overdue", "salesman")).toBe("overdue");
    expect(parseTaskQueue(undefined, "office")).toBe("open");
  });
});

describe("job list facts are not instructions and do not leak money", () => {
  const base = {
    status: "unscheduled",
    scheduledDate: null,
    todayYmd: "2026-09-26",
    warehouseReadyAt: null,
    openBalance: null as number | null,
  };

  it("a labor-only job is ready to schedule even when a purchase order exists", () => {
    const fact = jobQueueFact({
      ...base,
      hasMaterialNeed: false,
      purchaseOrders: [{ status: "ordered" }],
    });
    expect(fact).toContain("Ready to schedule");
    expect(fact).not.toContain("Waiting for material");
    expect(fact.toLowerCase()).not.toContain("schedule the install");
  });

  it("material that is not warehouse-ready stays waiting", () => {
    const fact = jobQueueFact({
      ...base,
      hasMaterialNeed: true,
      purchaseOrders: [],
    });
    expect(fact).toContain("Waiting for material");
    expect(fact).not.toContain("Ready to schedule");
  });

  it("hides balance unless the caller passes a balance", () => {
    expect(jobQueueFact({ ...base, hasMaterialNeed: false, openBalance: null })).not.toContain(
      "Balance due",
    );
    expect(jobQueueFact({ ...base, hasMaterialNeed: false, openBalance: 25 })).toContain(
      "Balance due",
    );
  });
});

describe("list pages stay role-scoped and bounded", () => {
  it("does not give money lists to scheduler, warehouse, or crew", () => {
    for (const role of ["scheduler", "warehouse", "crew", "customer"] as const) {
      expect(roleSeesMoneyList(role)).toBe(false);
      expect(MONEY_LIST_ROLES).not.toContain(role);
      expect(ORDER_LIST_ROLES).not.toContain(role);
    }
    expect(SERVICE_LIST_ROLES).not.toContain("crew");
    expect(SERVICE_LIST_ROLES).not.toContain("warehouse");
    expect(TASK_LIST_ROLES).not.toContain("scheduler");
    expect(TASK_LIST_ROLES).not.toContain("crew");
    expect(TASK_LIST_ROLES).not.toContain("warehouse");
    expect(resultCountLabel(40, 90, "order")).toBe("Showing 40 of 90 orders");
  });

  it("searches phones by digits", () => {
    expect(phoneSearchPattern("(216) 555-0100")).toBe("%216%555%0100%");
    expect(src("src/lib/data/customers.ts")).toContain("phoneSearchPattern");
  });

  it("loads orders, jobs, customers, invoices, and estimates through queue helpers", () => {
    const orders = src("src/app/(app)/orders/page.tsx");
    expect(orders).toContain("listOrdersQueue");
    expect(orders).not.toContain("listOrders(");
    expect(orders).toContain('!["admin", "office"].includes(profile.role)');
    expect(src("src/lib/data/orders.ts")).toContain(".range(");
    expect(src("src/lib/data/orders.ts")).toContain("focusId");
    expect(src("src/app/(app)/search/actions.ts")).toContain("/orders?focus=");

    const jobs = src("src/app/(app)/jobs/page.tsx");
    expect(jobs).toContain("listJobsQueue");
    expect(jobs).not.toContain("listJobs(");
    expect(jobs).toContain("openBalance: null");
    expect(jobs).not.toContain("formatMoney");
    expect(jobs).not.toContain("Schedule the install");
    expect(jobs).toContain("sm:grid-cols-2");
    expect(jobs).toContain('placeholder="Search customer, job, or address"');

    expect(src("src/lib/data/jobs.ts")).toContain("assessMaterialsReadyForSchedule");
    expect(src("src/lib/data/jobs.ts")).toContain(".range(");
    expect(src("src/lib/data/jobs.ts")).toContain("full_name.ilike");

    const customers = src("src/app/(app)/customers/page.tsx");
    expect(customers).toContain("listCustomersPage");
    expect(customers).toContain("WorkQueuePager");

    expect(src("src/app/(app)/estimates/page.tsx")).toContain("roleSeesMoneyList");
    expect(src("src/app/(app)/estimates/page.tsx")).toContain("listEstimatesQueue");
    expect(src("src/lib/data/estimates.ts")).toContain("customer.street");
    expect(src("src/app/(app)/invoices/page.tsx")).toContain("roleSeesMoneyList");
    expect(src("src/app/(app)/purchase-orders/page.tsx")).toContain("ORDER_LIST_ROLES");
    expect(src("src/app/(app)/invoices/page.tsx")).toContain("md:hidden");

    const service = src("src/app/(app)/service/page.tsx");
    expect(service).toContain("listServiceQueue");
    expect(service).toContain("SERVICE_LIST_ROLES");
    expect(service).toContain('label: "All"');
    expect(service).not.toContain("formatMoney");

    const tasks = src("src/app/(app)/tasks/page.tsx");
    expect(tasks).toContain("listTaskQueue");
    expect(tasks).toContain("seeAll");
    expect(tasks).toContain('profile.role === "salesman"');
    expect(tasks).not.toContain("formatMoney");
    expect(src("src/lib/data/ops-glue.ts")).toContain('.eq("assigned_to", args.userId)');
    expect(src("src/lib/nav.ts")).toContain('href: "/tasks"');
    expect(src("src/components/work-queue-bar.tsx")).toContain("min-h-11");
  });
});

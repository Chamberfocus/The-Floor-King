import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Upload, AlertTriangle, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SearchPicker } from "@/components/ui/search-picker";
import { listCustomersPage, getCustomerRowContexts, getCustomerListActivity } from "@/lib/data/customers";
import { QUEUE_LIST_UNAVAILABLE } from "@/lib/ops-scale";
import { WorkQueuePager } from "@/components/work-queue-bar";
import { parseListPage, resultCountLabel } from "@/lib/work-queues";
import { listWorkflowStages, listHandoffMembers } from "@/lib/data/workflow";
import { getSchedulingSettings, SCHEDULING_DEFAULTS } from "@/lib/data/scheduling";
import { getUserPreferences } from "@/lib/data/preferences";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { requireProfile } from "@/lib/auth";
import { SALES_ROLES, INSTALL_ROLES, STAGE_COLOR_BADGE } from "@/lib/types";
import { parseArrivalWindows } from "@/lib/format";
import {
  rethrowNavigation,
  runCustomersPhase,
  runCustomersPhaseSync,
} from "@/lib/customers-render-log";
import { buildCustomerListView, type CustomerListRowModel } from "@/lib/customers-list-view";
import { CustomerList } from "./customer-list";

export const metadata: Metadata = { title: "Customers" };

type ViewName = "active" | "closed" | "cancelled" | "all";

function one(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function finiteCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function hrefWith(
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/customers?${qs}` : "/customers";
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string | string[];
    stage?: string | string[];
    owner?: string | string[];
    stuck?: string | string[];
    view?: string | string[];
    page?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const q = one(sp.q);
  const stage = one(sp.stage) || undefined;
  const stuck = one(sp.stuck) === "1";
  const view: ViewName = ["closed", "cancelled", "all"].includes(one(sp.view))
    ? (one(sp.view) as ViewName)
    : "active";

  const profile = await runCustomersPhase(
    "customers.requireProfile",
    () => requireProfile(),
    (loaded) => ({ role: typeof loaded.role === "string" ? loaded.role : "missing" }),
  );
  const isAdmin = profile.role === "admin";
  const owner = isAdmin ? one(sp.owner) || undefined : undefined;
  const unassignedOnly = owner === "unassigned";

  let detailFailed = false;
  let stages: Awaited<ReturnType<typeof listWorkflowStages>> = [];
  try {
    stages = await runCustomersPhase(
      "customers.workflowStages",
      () => listWorkflowStages(),
      (rows) => ({ count: rows.length }),
    );
  } catch (error) {
    rethrowNavigation(error);
    stages = [];
    detailFailed = true;
  }

  const safeStages = stages.flatMap((s) => {
    if (!s || typeof s.id !== "string" || typeof s.name !== "string") return [];
    return [{
      id: s.id,
      name: s.name,
      color: typeof s.color === "string" && STAGE_COLOR_BADGE[s.color] ? s.color : "zinc",
      position: typeof s.position === "number" && Number.isFinite(s.position) ? s.position : 0,
      auto_action: typeof s.auto_action === "string" ? s.auto_action : null,
      owner_duty: typeof s.owner_duty === "string" ? s.owner_duty : null,
    }];
  });
  const closedStageIds = safeStages.filter((s) => /closed/i.test(s.name)).map((s) => s.id);

  let workflowStageIds: string[] | undefined;
  let excludeWorkflowStageIds: string[] | undefined;
  if (stage) workflowStageIds = [stage];
  else if (!q) {
    if (view === "closed") workflowStageIds = closedStageIds.length ? closedStageIds : undefined;
    else if (view === "active" && closedStageIds.length) excludeWorkflowStageIds = closedStageIds;
  }

  let listError: string | null = null;
  let listed: Awaited<ReturnType<typeof listCustomersPage>> = {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 40,
  };
  try {
    listed = await runCustomersPhase(
      "customers.listCustomers",
      () => listCustomersPage({
        search: q,
        workflowStageIds,
        excludeWorkflowStageIds,
        assignedTo: unassignedOnly ? undefined : owner,
        unassignedOnly,
        stuckOnly: stuck,
        cancelledOnly: view === "cancelled" && !q,
        excludeCancelled: !q && (view === "active" || view === "closed"),
        page: parseListPage(one(sp.page) || undefined),
      }),
      (result) => ({ count: result.rows.length, total: finiteCount(result.total) }),
    );
  } catch (error) {
    rethrowNavigation(error);
    listError = QUEUE_LIST_UNAVAILABLE;
  }

  const customerIds = listed.rows.flatMap((row) =>
    row && typeof row.id === "string" ? [row.id] : [],
  );

  let members: Awaited<ReturnType<typeof listHandoffMembers>> = [];
  let schedSettings = SCHEDULING_DEFAULTS;
  let prefs = DEFAULT_PREFERENCES;
  let contexts: Awaited<ReturnType<typeof getCustomerRowContexts>> = {};
  let activity: Awaited<ReturnType<typeof getCustomerListActivity>> = {};

  if (!listError) {
    try {
      members = await runCustomersPhase(
        "customers.handoffMembers",
        () => listHandoffMembers(),
        (rows) => ({ count: rows.length }),
      );
    } catch (error) {
      rethrowNavigation(error);
      members = [];
      detailFailed = true;
    }
    try {
      schedSettings = await runCustomersPhase(
        "customers.schedulingSettings",
        () => getSchedulingSettings(),
        () => ({ present: true }),
      );
    } catch (error) {
      rethrowNavigation(error);
      schedSettings = SCHEDULING_DEFAULTS;
      detailFailed = true;
    }
    try {
      prefs = await runCustomersPhase(
        "customers.userPreferences",
        () => getUserPreferences(),
        (value) => ({ actions: Array.isArray(value.listActions) ? value.listActions.length : 0 }),
      );
    } catch (error) {
      rethrowNavigation(error);
      prefs = DEFAULT_PREFERENCES;
      detailFailed = true;
    }
    try {
      contexts = await runCustomersPhase(
        "customers.rowContexts",
        () => getCustomerRowContexts(customerIds),
        (value) => ({ count: value && typeof value === "object" ? Object.keys(value).length : 0 }),
      );
    } catch (error) {
      rethrowNavigation(error);
      contexts = {};
      detailFailed = true;
    }
    try {
      activity = await runCustomersPhase(
        "customers.activity",
        () => getCustomerListActivity(customerIds),
        (value) => ({ count: value && typeof value === "object" ? Object.keys(value).length : 0 }),
      );
    } catch (error) {
      rethrowNavigation(error);
      activity = {};
      detailFailed = true;
    }
  }

  const total = finiteCount(listed.total);
  const page = finiteCount(listed.page) || 1;
  const pageSize = finiteCount(listed.pageSize) || 40;
  const customerPages = Math.max(1, Math.ceil(total / pageSize));
  const detailError = detailFailed ? QUEUE_LIST_UNAVAILABLE : null;
  if (!listError && detailFailed && listed.rows.length === 0) listError = QUEUE_LIST_UNAVAILABLE;

  const listHref = hrefWith({
    q,
    stage,
    owner,
    stuck: stuck ? "1" : undefined,
    view: view !== "active" ? view : undefined,
    page: page > 1 ? String(page) : undefined,
  });

  let rows: CustomerListRowModel[] = [];
  if (!listError) {
    try {
      const built = runCustomersPhaseSync(
        "customers.transform",
        () => buildCustomerListView({
          customers: listed.rows,
          contexts,
          activity,
          stages: safeStages,
          members,
          reps: members
            .filter((m) => (SALES_ROLES as string[]).includes(m.role))
            .map((m) => ({ id: m.id, name: m.name })),
          installOptions: members
            .filter((m) => (INSTALL_ROLES as string[]).includes(m.role))
            .map((m) => ({ id: m.id, name: m.name })),
          arrivalWindows: parseArrivalWindows(
            schedSettings && typeof schedSettings === "object" ? schedSettings.arrival_windows : null,
          ),
          listActions: Array.isArray(prefs?.listActions) ? prefs.listActions : DEFAULT_PREFERENCES.listActions,
          canCloseOut: ["admin", "office", "sales_manager"].includes(profile.role),
          listHref,
        }),
        (built) => ({ count: built.rows.length, dropped: built.dropped }),
      );
      rows = built.rows;
      if (!rows.length && listed.rows.length > 0) listError = QUEUE_LIST_UNAVAILABLE;
    } catch (error) {
      rethrowNavigation(error);
      listError = QUEUE_LIST_UNAVAILABLE;
      rows = [];
    }
  }

  const screen = runCustomersPhaseSync(
    "customers.renderPreparation",
    () => ({
      mode: listError ? "unavailable" as const : rows.length ? "list" as const : "empty" as const,
      rows,
      detailError: listError ? null : detailError,
      headerDescription: total
        ? `${resultCountLabel(rows.length, total, "customer")} — one row per customer.`
        : "Everyone in your pipeline — leads and customers alike.",
      stageOptions: [
        { value: "", label: "All stages" },
        ...safeStages.map((s) => ({ value: s.id, label: s.name })),
      ],
      ownerOptions: [
        { value: "", label: "All salespeople" },
        { value: "unassigned", label: "— Unassigned —" },
        ...members
          .filter((m) => (SALES_ROLES as string[]).includes(m.role))
          .map((m) => ({ value: m.id, label: m.name })),
      ],
    }),
    (prepared) => ({ mode: prepared.mode, count: prepared.rows.length }),
  );

  const stuckHref = hrefWith({
    q,
    stage,
    owner,
    stuck: stuck ? undefined : "1",
    view: view !== "active" ? view : undefined,
  });
  const viewHref = (next: ViewName) => hrefWith({
    q,
    owner,
    stuck: stuck ? "1" : undefined,
    view: next !== "active" ? next : undefined,
  });
  const VIEWS: { v: ViewName; label: string }[] = [
    { v: "active", label: "Active" },
    { v: "closed", label: "Closed" },
    { v: "cancelled", label: "Cancelled" },
    { v: "all", label: "All" },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description={screen.headerDescription}
      >
        <div className="flex gap-2">
          <Link href="/customers/import" className={buttonVariants({ size: "lg", variant: "outline" })}>
            <Upload className="size-4" /> Import customers
          </Link>
          <Link href="/customers/new" data-tour="add-customer" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> Add customer
          </Link>
        </div>
      </PageHeader>

      <div data-tour="manage-customers" className="mb-4 inline-flex rounded-lg border p-0.5">
        {VIEWS.map((t) => (
          <Link
            key={t.v}
            href={viewHref(t.v)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              view === t.v && !stage
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search name, phone, email, address, job…"
            className="h-11 pl-8"
          />
        </div>
        <SearchPicker
          className="w-52"
          name="stage"
          defaultValue={stage ?? ""}
          placeholder="All stages"
          options={screen.stageOptions}
        />
        {isAdmin ? (
          <SearchPicker
            className="w-48"
            name="owner"
            defaultValue={owner ?? ""}
            placeholder="All salespeople"
            allowClear
            options={screen.ownerOptions}
          />
        ) : null}
        <Button type="submit" variant="outline" size="lg">
          Search
        </Button>
        <Link
          href={stuckHref}
          className={buttonVariants({
            variant: stuck ? "default" : "outline",
            size: "lg",
            className: stuck ? "" : "border-destructive/40 text-destructive hover:bg-destructive/10",
          })}
        >
          <AlertTriangle className="size-4" /> Follow-ups due{stuck ? " ✓" : ""}
        </Link>
        {(q || stage || owner || stuck) && (
          <Link href="/customers" className={buttonVariants({ variant: "ghost", size: "lg" })}>
            Clear
          </Link>
        )}
      </form>

      {listError ? (
        <EmptyState icon={Users} title={QUEUE_LIST_UNAVAILABLE} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            q || stage || owner || stuck
              ? stuck
                ? "No follow-ups are due."
                : q
                  ? "No customers match this search."
                  : "No customers match these filters."
              : "No customers yet"
          }
          description={q || stage || owner || stuck ? undefined : "Add your first lead to get started."}
          action={
            !q && !stage && !owner && !stuck ? (
              <Link href="/customers/new" className={buttonVariants({})}>
                <Plus className="size-4" /> Add customer
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {screen.detailError ? (
            <p className="mb-3 text-sm text-destructive">{screen.detailError}</p>
          ) : null}
          <CustomerList rows={rows} isAdmin={isAdmin} />
        </>
      )}
      <WorkQueuePager
        page={page}
        pages={customerPages}
        hrefFor={(nextPage) => hrefWith({
          q,
          stage,
          owner,
          stuck: stuck ? "1" : undefined,
          view: view !== "active" ? view : undefined,
          page: nextPage > 1 ? String(nextPage) : undefined,
        })}
      />
    </div>
  );
}

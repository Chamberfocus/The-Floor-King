import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Upload, AlertTriangle, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SearchPicker } from "@/components/ui/search-picker";
import { listCustomers, getCustomerRowContexts, getCustomerListActivity } from "@/lib/data/customers";
import { listWorkflowStages, listHandoffMembers } from "@/lib/data/workflow";
import { getSchedulingSettings } from "@/lib/data/scheduling";
import { getUserPreferences } from "@/lib/data/preferences";
import { requireProfile } from "@/lib/auth";
import { SALES_ROLES, INSTALL_ROLES } from "@/lib/types";
import { parseArrivalWindows } from "@/lib/format";
import { CustomerList, type ListShared } from "./customer-list";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    stage?: string;
    owner?: string;
    stuck?: string;
    view?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  // The stage filter is now a detailed workflow stage id (the 13-stage builder),
  // not the collapsed 6-bucket lead stage.
  const stage = sp.stage?.trim() || undefined;
  // "Stuck only" — clients past their stage's time limit. Available to everyone
  // (RLS already scopes reps to their own book).
  const stuck = sp.stuck === "1";

  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";
  // Admins can filter the list down to one salesperson's book, or to clients
  // that still have no salesperson ("unassigned").
  const owner = isAdmin ? sp.owner?.trim() || undefined : undefined;
  const unassignedOnly = owner === "unassigned";

  // Load stages first so we can hide "Closed" customers from the active list by
  // default (they're still reachable by picking Closed in the stage filter).
  const stages = await listWorkflowStages();
  const closedStageIds = stages
    .filter((s) => /closed/i.test(s.name))
    .map((s) => s.id);

  // Active | Closed | Cancelled | All. Default active (hide closed + cancelled).
  // A name search always spans everyone, so you can find a past customer even if
  // they're closed or cancelled.
  const view: "active" | "closed" | "cancelled" | "all" = [
    "closed",
    "cancelled",
    "all",
  ].includes(sp.view ?? "")
    ? (sp.view as "closed" | "cancelled" | "all")
    : "active";
  let workflowStageIds: string[] | undefined;
  let excludeWorkflowStageIds: string[] | undefined;
  if (stage) {
    workflowStageIds = [stage];
  } else if (!q) {
    // Only the view toggle constrains stages — a name search spans everyone.
    if (view === "closed")
      workflowStageIds = closedStageIds.length ? closedStageIds : undefined;
    else if (view === "active" && closedStageIds.length)
      excludeWorkflowStageIds = closedStageIds;
  }

  const customers = await listCustomers({
    search: q,
    workflowStageIds,
    excludeWorkflowStageIds,
    assignedTo: unassignedOnly ? undefined : owner,
    unassignedOnly,
    stuckOnly: stuck,
    // Cancelled stays out of active/closed and gets its own view. A name search
    // still spans cancelled so past customers are findable.
    cancelledOnly: view === "cancelled" && !q,
    excludeCancelled: !q && (view === "active" || view === "closed"),
  });

  // Shared data for per-row quick actions — fetched once for the whole list.
  const [members, schedSettings, prefs, contexts, activity] = await Promise.all([
    listHandoffMembers(),
    getSchedulingSettings(),
    getUserPreferences(),
    getCustomerRowContexts(customers.map((c) => c.id)),
    getCustomerListActivity(customers.map((c) => c.id)),
  ]);
  const shared: ListShared = {
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color ?? "zinc",
      position: s.position ?? 0,
      auto_action: s.auto_action ?? null,
      owner_duty: s.owner_duty ?? null,
    })),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      title: m.title,
      role: m.role,
    })),
    reps: members
      .filter((m) => (SALES_ROLES as string[]).includes(m.role))
      .map((m) => ({ id: m.id, name: m.name })),
    installOptions: members
      .filter((m) => (INSTALL_ROLES as string[]).includes(m.role))
      .map((m) => ({ id: m.id, name: m.name })),
    arrivalWindows: parseArrivalWindows(schedSettings.arrival_windows),
    listActions: prefs.listActions,
    // Same roles the close-out page itself requires — showing the button to
    // anyone else would only hand them a permission error.
    canCloseOut: ["admin", "office", "sales_manager"].includes(profile.role),
    listHref: (() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (stage) params.set("stage", stage);
      if (owner) params.set("owner", owner);
      if (stuck) params.set("stuck", "1");
      if (view !== "active") params.set("view", view);
      const qs = params.toString();
      return qs ? `/customers?${qs}` : "/customers";
    })(),
  };

  // Toggle link for the "Stuck only" filter — keeps the other filters intact.
  const stuckHref = (() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (stage) params.set("stage", stage);
    if (owner) params.set("owner", owner);
    if (!stuck) params.set("stuck", "1");
    if (view !== "active") params.set("view", view);
    const qs = params.toString();
    return qs ? `/customers?${qs}` : "/customers";
  })();

  // Active | Closed | All tabs — preserve search/owner/stuck, drop the specific
  // stage filter (the tab is the high-level stage control).
  const viewHref = (v: "active" | "closed" | "cancelled" | "all") => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (owner) params.set("owner", owner);
    if (stuck) params.set("stuck", "1");
    if (v !== "active") params.set("view", v);
    const qs = params.toString();
    return qs ? `/customers?${qs}` : "/customers";
  };
  const VIEWS: { v: "active" | "closed" | "cancelled" | "all"; label: string }[] = [
    { v: "active", label: "Active" },
    { v: "closed", label: "Closed" },
    { v: "cancelled", label: "Cancelled" },
    { v: "all", label: "All" },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description={
          customers.length
            ? `${customers.length} customer${customers.length === 1 ? "" : "s"} — one row per customer.`
            : "Everyone in your pipeline — leads and customers alike."
        }
      >
        <div className="flex gap-2">
          <Link
            href="/customers/import"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            <Upload className="size-4" /> Import customers
          </Link>
          <Link
            href="/customers/new"
            data-tour="add-customer"
            className={buttonVariants({ size: "lg" })}
          >
            <Plus className="size-4" /> Add customer
          </Link>
        </div>
      </PageHeader>

      {/* Active | Closed | Cancelled | All */}
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

      {/* Search + filter (works without JavaScript) */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search name, phone, email, address, job…"
            className="pl-8"
          />
        </div>
        <SearchPicker
          className="w-52"
          name="stage"
          defaultValue={stage ?? ""}
          placeholder="All stages"
          options={[
            { value: "", label: "All stages" },
            ...stages.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        {isAdmin ? (
          <SearchPicker
            className="w-48"
            name="owner"
            defaultValue={owner ?? ""}
            placeholder="All salespeople"
            allowClear
            options={[
              { value: "", label: "All salespeople" },
              { value: "unassigned", label: "— Unassigned —" },
              ...members
                .filter((m) => (SALES_ROLES as string[]).includes(m.role))
                .map((m) => ({ value: m.id, label: m.name })),
            ]}
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
            className: stuck
              ? ""
              : "border-destructive/40 text-destructive hover:bg-destructive/10",
          })}
        >
          <AlertTriangle className="size-4" /> Stuck{stuck ? " ✓" : ""}
        </Link>
        {(q || stage || owner || stuck) && (
          <Link
            href="/customers"
            className={buttonVariants({ variant: "ghost", size: "lg" })}
          >
            Clear
          </Link>
        )}
      </form>

      {customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={
            q || stage || owner || stuck
              ? stuck
                ? "No stuck customers — everyone's on track 🎉"
                : "No customers match your search"
              : "No customers yet"
          }
          description={
            q || stage || owner || stuck
              ? undefined
              : "Add your first lead to get started."
          }
          action={
            !q && !stage && !owner && !stuck ? (
              <Link href="/customers/new" className={buttonVariants({})}>
                <Plus className="size-4" /> Add customer
              </Link>
            ) : undefined
          }
        />
      ) : (
        <CustomerList
          customers={customers}
          contexts={contexts}
          activity={activity}
          shared={shared}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

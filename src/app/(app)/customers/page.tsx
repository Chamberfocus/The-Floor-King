import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Upload, AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SearchPicker } from "@/components/ui/search-picker";
import { listCustomers, getCustomerRowContexts } from "@/lib/data/customers";
import { listWorkflowStages, listHandoffMembers } from "@/lib/data/workflow";
import { getSchedulingSettings } from "@/lib/data/scheduling";
import { getUserPreferences } from "@/lib/data/preferences";
import { requireProfile } from "@/lib/auth";
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  SALES_ROLES,
  INSTALL_ROLES,
  type LeadStage,
} from "@/lib/types";
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
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const stageParam = sp.stage as LeadStage | undefined;
  const stage =
    stageParam && LEAD_STAGE_ORDER.includes(stageParam) ? stageParam : undefined;
  // "Stuck only" — clients past their stage's time limit. Available to everyone
  // (RLS already scopes reps to their own book).
  const stuck = sp.stuck === "1";

  const profile = await requireProfile();
  const isAdmin = profile.role === "admin";
  // Admins can filter the list down to one salesperson's book, or to clients
  // that still have no salesperson ("unassigned").
  const owner = isAdmin ? sp.owner?.trim() || undefined : undefined;
  const unassignedOnly = owner === "unassigned";

  const customers = await listCustomers({
    search: q,
    stage,
    assignedTo: unassignedOnly ? undefined : owner,
    unassignedOnly,
    stuckOnly: stuck,
  });

  // Shared data for per-row quick actions — fetched once for the whole list.
  const [stages, members, schedSettings, prefs, contexts] = await Promise.all([
    listWorkflowStages(),
    listHandoffMembers(),
    getSchedulingSettings(),
    getUserPreferences(),
    getCustomerRowContexts(customers.map((c) => c.id)),
  ]);
  const shared: ListShared = {
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
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
    listHref: (() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (stage) params.set("stage", stage);
      if (owner) params.set("owner", owner);
      if (stuck) params.set("stuck", "1");
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
    const qs = params.toString();
    return qs ? `/customers?${qs}` : "/customers";
  })();

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Everyone in your pipeline — leads and customers alike."
      >
        <div className="flex gap-2">
          <Link
            href="/customers/import"
            className={buttonVariants({ size: "lg", variant: "outline" })}
          >
            <Upload className="size-4" /> Import clients
          </Link>
          <Link href="/customers/new" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> Add customer
          </Link>
        </div>
      </PageHeader>

      {/* Search + filter (works without JavaScript) */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search name, phone, email, city…"
            className="pl-8"
          />
        </div>
        <SearchPicker
          className="w-44"
          name="stage"
          defaultValue={stage ?? ""}
          placeholder="All stages"
          options={[
            { value: "", label: "All stages" },
            ...LEAD_STAGE_ORDER.map((s) => ({
              value: s,
              label: LEAD_STAGE_LABELS[s],
            })),
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
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {q || stage || owner || stuck
              ? stuck
                ? "No stuck clients — everyone's on track. 🎉"
                : "No customers match your search."
              : "No customers yet. Add your first lead to get started."}
          </p>
          {!q && !stage && !owner && !stuck ? (
            <Link
              href="/customers/new"
              className={buttonVariants({ className: "mt-4" })}
            >
              <Plus className="size-4" /> Add customer
            </Link>
          ) : null}
        </div>
      ) : (
        <CustomerList
          customers={customers}
          contexts={contexts}
          shared={shared}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

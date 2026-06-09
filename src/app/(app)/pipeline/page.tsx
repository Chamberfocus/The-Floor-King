import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, User, AlertTriangle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listCustomers, getProfileNames } from "@/lib/data/customers";
import { listWorkflowStages } from "@/lib/data/workflow";
import { STAGE_COLOR_BADGE, type Customer } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; mine?: string; overdue?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/");

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const mine = sp.mine === "1";
  const overdueOnly = sp.overdue === "1";

  const stages = await listWorkflowStages();
  let customers = await listCustomers({ search: q });
  if (mine) {
    customers = customers.filter((c) => c.workflow_owner_id === profile.id);
  }

  const nowMs = Date.now();
  const isOverdue = (c: Customer) =>
    !!c.next_action_due && new Date(c.next_action_due).getTime() < nowMs;
  const overdueCount = customers.filter(isOverdue).length;
  if (overdueOnly) customers = customers.filter(isOverdue);

  const ownerIds = [
    ...new Set(customers.map((c) => c.workflow_owner_id).filter(Boolean)),
  ] as string[];
  const ownerNames = await getProfileNames(ownerIds);

  const byStage = new Map<string, Customer[]>();
  const noStage: Customer[] = [];
  for (const c of customers) {
    if (c.workflow_stage_id) {
      const arr = byStage.get(c.workflow_stage_id) ?? [];
      arr.push(c);
      byStage.set(c.workflow_stage_id, arr);
    } else {
      noStage.push(c);
    }
  }

  const columns = [
    ...(noStage.length
      ? [{ id: "none", name: "No stage yet", color: "zinc", items: noStage }]
      : []),
    ...stages.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      items: byStage.get(s.id) ?? [],
    })),
  ];

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Every client by stage, and who owns each one right now."
      >
        <Link
          href={mine ? "/pipeline" : "/pipeline?mine=1"}
          className={buttonVariants({
            variant: mine ? "default" : "outline",
            size: "lg",
          })}
        >
          <User className="size-4" /> {mine ? "Showing my queue" : "My queue"}
        </Link>
      </PageHeader>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        {mine ? <input type="hidden" name="mine" value="1" /> : null}
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search clients…"
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {overdueCount > 0 || overdueOnly ? (
        <Link
          href={
            overdueOnly
              ? mine
                ? "/pipeline?mine=1"
                : "/pipeline"
              : mine
                ? "/pipeline?mine=1&overdue=1"
                : "/pipeline?overdue=1"
          }
          className={cn(
            "mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
            overdueOnly
              ? "border-primary bg-primary/5"
              : "border-destructive/40 bg-destructive/5 text-destructive",
          )}
        >
          <AlertTriangle className="size-4" />
          {overdueOnly
            ? "Showing overdue only — clear filter"
            : `${overdueCount} lead${overdueCount === 1 ? "" : "s"} overdue — show only these`}
        </Link>
      ) : null}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <section key={col.id} className="w-72 shrink-0">
            <div className="mb-3 flex items-center justify-between px-1">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                  STAGE_COLOR_BADGE[col.color] ?? STAGE_COLOR_BADGE.zinc,
                )}
              >
                {col.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {col.items.length}
              </span>
            </div>
            <div className="space-y-2">
              {col.items.map((c) => {
                const over = isOverdue(c);
                return (
                  <Link
                    key={c.id}
                    href={`/customers/${c.id}`}
                    className={cn(
                      "block rounded-lg border bg-card p-3 shadow-sm transition-colors hover:bg-muted/50",
                      over && "border-destructive/50 ring-1 ring-destructive/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{c.full_name}</div>
                      {over ? (
                        <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
                      ) : null}
                    </div>
                    {c.city ? (
                      <div className="text-xs text-muted-foreground">
                        {c.city}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="size-3" />
                      {c.workflow_owner_id
                        ? (ownerNames[c.workflow_owner_id] ?? "Owner")
                        : "Unassigned"}
                    </div>
                  </Link>
                );
              })}
              {col.items.length === 0 ? (
                <div className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Empty
                </div>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

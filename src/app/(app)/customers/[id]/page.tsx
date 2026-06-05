import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  StickyNote,
  Phone,
  MessageSquare,
  Mail,
  ArrowLeftRight,
  Info,
  Plus,
  FileText,
  Wrench,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StageBadge } from "@/components/stage-badge";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import {
  getCustomer,
  listActivities,
  getProfileNames,
} from "@/lib/data/customers";
import { listEstimatesForCustomer } from "@/lib/data/estimates";
import { listJobsForCustomer } from "@/lib/data/jobs";
import { createJob } from "@/app/(app)/jobs/actions";
import { JobStatusBadge } from "@/components/job-status-badge";
import { listInvoicesForCustomer, amountPaid } from "@/lib/data/invoices";
import { createInvoice } from "@/app/(app)/invoices/actions";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { optionTotals } from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import { type ActivityType } from "@/lib/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { StageSelect } from "./stage-select";
import { AddActivityForm } from "./add-activity-form";
import { CustomerInfoCard } from "./customer-info-card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const customer = await getCustomer(id);
  return { title: customer?.full_name ?? "Customer" };
}

const ACTIVITY_ICON: Record<ActivityType, LucideIcon> = {
  note: StickyNote,
  call: Phone,
  text: MessageSquare,
  email: Mail,
  stage_change: ArrowLeftRight,
  system: Info,
};

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const activities = await listActivities(id);
  const estimates = await listEstimatesForCustomer(id);
  const jobs = await listJobsForCustomer(id);
  const invoices = await listInvoicesForCustomer(id);
  const names = await getProfileNames([
    ...activities.map((a) => a.user_id ?? ""),
    customer.assigned_to ?? "",
    customer.created_by ?? "",
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to customers
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {customer.full_name}
            </h1>
            <StageBadge stage={customer.stage} />
          </div>
          <p className="text-sm text-muted-foreground">
            Added {formatDate(customer.created_at)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: stage + contact */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Pipeline stage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <StageSelect id={customer.id} stage={customer.stage} />
              {customer.assigned_to && names[customer.assigned_to] ? (
                <p className="text-xs text-muted-foreground">
                  Owner: {names[customer.assigned_to]}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <CustomerInfoCard customer={customer} />
        </div>

        {/* Right: estimates + activity timeline */}
        <div className="space-y-6 lg:col-span-2">
          {/* Estimates */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Estimates</CardTitle>
              <Link
                href={`/estimates/new?customer=${customer.id}`}
                className={buttonVariants({ size: "sm" })}
              >
                <Plus className="size-3.5" /> New estimate
              </Link>
            </CardHeader>
            <CardContent>
              {estimates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No estimates yet. Click &ldquo;New estimate&rdquo; to build a quote.
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {estimates.map((e) => {
                    const opts = e.options ?? [];
                    const opt =
                      (e.accepted_option_id &&
                        opts.find((o) => o.id === e.accepted_option_id)) ||
                      opts[0];
                    const total = opt
                      ? optionTotals(opt.line_items ?? [], e.tax_rate).total
                      : 0;
                    return (
                      <li
                        key={e.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <Link
                          href={`/estimates/${e.id}`}
                          className="flex min-w-0 items-center gap-2 hover:underline"
                        >
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">
                            {e.title || "Estimate"}
                          </span>
                        </Link>
                        <div className="flex shrink-0 items-center gap-3">
                          <EstimateStatusBadge status={e.status} />
                          <span className="font-medium">
                            {formatMoney(total)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Jobs */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Jobs</CardTitle>
              <form action={createJob}>
                <input type="hidden" name="customer_id" value={customer.id} />
                <button type="submit" className={buttonVariants({ size: "sm" })}>
                  <Wrench className="size-3.5" /> New job
                </button>
              </form>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {jobs.map((j) => (
                    <li
                      key={j.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <Link
                        href={`/jobs/${j.id}`}
                        className="flex min-w-0 items-center gap-2 hover:underline"
                      >
                        <Wrench className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{j.title || "Job"}</span>
                      </Link>
                      <div className="flex shrink-0 items-center gap-3">
                        <JobStatusBadge status={j.status} />
                        {j.scheduled_date ? (
                          <span className="text-muted-foreground">
                            {formatDate(j.scheduled_date)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Invoices */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Invoices</CardTitle>
              <form action={createInvoice}>
                <input type="hidden" name="customer_id" value={customer.id} />
                <button type="submit" className={buttonVariants({ size: "sm" })}>
                  <Receipt className="size-3.5" /> New invoice
                </button>
              </form>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {invoices.map((inv) => {
                    const t = invoiceTotals(
                      inv.items ?? [],
                      inv.tax_rate,
                      amountPaid(inv),
                    );
                    return (
                      <li
                        key={inv.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="flex min-w-0 items-center gap-2 hover:underline"
                        >
                          <Receipt className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">
                            {inv.number || "Invoice"}
                          </span>
                        </Link>
                        <div className="flex shrink-0 items-center gap-3">
                          <InvoiceStatusBadge status={inv.status} />
                          <span className="font-medium">
                            {formatMoney(t.balance)} due
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <AddActivityForm customerId={customer.id} />

              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No activity yet. Log your first call or note above.
                </p>
              ) : (
                <ol className="space-y-4 border-t pt-4">
                  {activities.map((a) => {
                    const Icon = ACTIVITY_ICON[a.type];
                    const who = a.user_id ? names[a.user_id] : null;
                    return (
                      <li key={a.id} className="flex gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Icon className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap text-sm">{a.body}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {who ? `${who} · ` : ""}
                            {formatDateTime(a.created_at)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

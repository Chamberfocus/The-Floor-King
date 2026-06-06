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
  Sparkles,
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
  getPortalUser,
} from "@/lib/data/customers";
import { listEstimatesForCustomer } from "@/lib/data/estimates";
import { listJobsForCustomer } from "@/lib/data/jobs";
import { createJob } from "@/app/(app)/jobs/actions";
import { JobStatusBadge } from "@/components/job-status-badge";
import { listInvoicesForCustomer, amountPaid } from "@/lib/data/invoices";
import { listCustomerMessages } from "@/lib/data/messages";
import { listCustomerDocuments } from "@/lib/data/documents";
import { CustomerDocuments } from "./customer-documents";
import {
  listWorkflowStages,
  listHandoffMembers,
  listHandoffs,
} from "@/lib/data/workflow";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { createEstimate } from "@/app/(app)/estimates/actions";
import { createInvoice } from "@/app/(app)/invoices/actions";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { optionTotals } from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import { STAGE_COLOR_BADGE, type ActivityType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { StageSelect } from "./stage-select";
import { AddActivityForm } from "./add-activity-form";
import { CustomerInfoCard } from "./customer-info-card";
import { InvitePortalForm } from "./invite-portal-form";
import { CustomerChat } from "./customer-chat";
import { HandoffControl } from "./handoff-control";
import { OnTheWayButton } from "./on-the-way-button";
import { QualifyPanel } from "./qualify-panel";

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
  const portalUser = await getPortalUser(id);
  const messages = await listCustomerMessages(id);
  const documents = await listCustomerDocuments(id);
  const stages = await listWorkflowStages();
  const handoffMembers = await listHandoffMembers();
  const handoffHistory = await listHandoffs(id);
  const qualifyingQuestions = await listQualifyingQuestions({ activeOnly: true });
  const names = await getProfileNames([
    ...activities.map((a) => a.user_id ?? ""),
    customer.assigned_to ?? "",
    customer.created_by ?? "",
    customer.workflow_owner_id ?? "",
  ]);
  const currentStage =
    stages.find((s) => s.id === customer.workflow_stage_id) ?? null;
  const ownerName = customer.workflow_owner_id
    ? (names[customer.workflow_owner_id] ?? null)
    : null;

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
        <OnTheWayButton customerId={customer.id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: workflow + stage + contact */}
        <div className="space-y-6">
          {/* Workflow & handoff */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow &amp; handoff</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Current stage
                  </div>
                  {currentStage ? (
                    <span
                      className={cn(
                        "mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        STAGE_COLOR_BADGE[currentStage.color] ??
                          STAGE_COLOR_BADGE.zinc,
                      )}
                    >
                      {currentStage.name}
                    </span>
                  ) : (
                    <div className="text-muted-foreground">Not started</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Owner</div>
                  <div className="font-medium">{ownerName ?? "Unassigned"}</div>
                </div>
              </div>

              <HandoffControl
                customerId={customer.id}
                currentStageId={customer.workflow_stage_id}
                currentOwnerId={customer.workflow_owner_id}
                stages={stages}
                members={handoffMembers}
              />

              {handoffHistory.length ? (
                <div className="border-t pt-3">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Recent handoffs
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {handoffHistory.slice(0, 5).map((h) => (
                      <li key={h.id}>
                        → {h.to_stage_name ?? "stage"} ·{" "}
                        {h.to_name ?? "unassigned"} · {formatDate(h.created_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <QualifyPanel
            customerId={customer.id}
            questions={qualifyingQuestions}
            qualified={customer.qualified}
          />

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

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer portal</CardTitle>
            </CardHeader>
            <CardContent>
              {portalUser ? (
                <p className="text-sm text-muted-foreground">
                  Portal access enabled for{" "}
                  <span className="font-medium text-foreground">
                    {portalUser.email}
                  </span>
                  .
                </p>
              ) : (
                <InvitePortalForm
                  customerId={customer.id}
                  defaultEmail={customer.email ?? ""}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: chat + estimates + activity timeline */}
        <div className="space-y-6 lg:col-span-2">
          {/* Chat */}
          <CustomerChat customerId={customer.id} messages={messages} />

          {/* Estimates */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Estimates</CardTitle>
              {customer.source ? (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/estimates/new?customer=${customer.id}`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    <Sparkles className="size-3.5" /> Wizard
                  </Link>
                  <form action={createEstimate}>
                    <input type="hidden" name="customer_id" value={customer.id} />
                    <button
                      type="submit"
                      className={buttonVariants({
                        variant: "outline",
                        size: "sm",
                      })}
                    >
                      <Plus className="size-3.5" /> Blank
                    </button>
                  </form>
                </div>
              ) : (
                <span className="text-xs font-medium text-amber-600">
                  Set a lead source (Edit) to create estimates
                </span>
              )}
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

          {/* Documents */}
          <CustomerDocuments customerId={customer.id} documents={documents} />

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

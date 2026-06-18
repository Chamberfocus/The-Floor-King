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
import { getJob } from "@/lib/data/jobs";
import {
  getSchedulingSettings,
  getInstallerSuggestions,
} from "@/lib/data/scheduling";
import { installDaysForJob } from "@/lib/scheduling";
import { CustomerDocuments } from "./customer-documents";
import {
  listWorkflowStages,
  listHandoffMembers,
} from "@/lib/data/workflow";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { createEstimate } from "@/app/(app)/estimates/actions";
import { createInvoice } from "@/app/(app)/invoices/actions";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { optionTotals } from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import { type ActivityType, STAGE_COLOR_BADGE } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { AddActivityForm } from "./add-activity-form";
import { CustomerInfoCard } from "./customer-info-card";
import { InvitePortalForm } from "./invite-portal-form";
import { CustomerChat } from "./customer-chat";
import { OnTheWayButton } from "./on-the-way-button";
import { GuidedFlow } from "./guided-flow";
import { CancelCustomer } from "./cancel-customer";
import { DeleteCustomer } from "./delete-customer";
import { AiFollowup } from "./ai-followup";
import { AiQuote } from "./ai-quote";
import { requireProfile } from "@/lib/auth";

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
  const profile = await requireProfile();
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const canDelete = profile.role === "admin" || profile.role === "office";

  const activities = await listActivities(id);
  const estimates = await listEstimatesForCustomer(id);
  const jobs = await listJobsForCustomer(id);
  const invoices = await listInvoicesForCustomer(id);
  const portalUser = await getPortalUser(id);
  const messages = await listCustomerMessages(id);
  const documents = await listCustomerDocuments(id);
  const stages = await listWorkflowStages();
  const handoffMembers = await listHandoffMembers();
  const qualifyingQuestions = await listQualifyingQuestions({ activeOnly: true });
  const names = await getProfileNames([
    ...activities.map((a) => a.user_id ?? ""),
    customer.assigned_to ?? "",
    customer.created_by ?? "",
    customer.workflow_owner_id ?? "",
  ]);
  const currentStage =
    stages.find((s) => s.id === customer.workflow_stage_id) ?? null;
  const autoAction = currentStage?.auto_action ?? "none";

  // Money status for the command center.
  const money = invoices.reduce(
    (acc, inv) => {
      const paid = amountPaid(inv);
      const t = invoiceTotals(inv.items ?? [], inv.tax_rate, paid);
      acc.invoiced += t.total;
      acc.paid += paid;
      acc.balance += t.balance;
      return acc;
    },
    { invoiced: 0, paid: 0, balance: 0 },
  );
  const ownerName = customer.workflow_owner_id
    ? (names[customer.workflow_owner_id] ?? null)
    : null;

  // When the stage auto-action is "schedule install", pop install suggestions
  // for the customer's latest job right here on the file.
  const repOptions = handoffMembers.map((m) => ({ id: m.id, name: m.name }));
  let installPop: {
    jobId: string;
    days: number;
    suggestions: { installerId: string; name: string; days: number; start: string; end: string }[];
  } | null = null;
  if (autoAction === "schedule_install" && jobs.length) {
    const targetJob =
      jobs.find((j) => j.status !== "completed" && j.status !== "cancelled") ??
      jobs[0];
    const jobDetail = await getJob(targetJob.id);
    if (jobDetail?.line_items?.length) {
      const settings = await getSchedulingSettings();
      const est = installDaysForJob(jobDetail.line_items, settings);
      const suggestions =
        est.days > 0
          ? await getInstallerSuggestions(jobDetail.line_items, settings)
          : [];
      installPop = { jobId: targetJob.id, days: est.days, suggestions };
    }
  }

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
            {currentStage ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  STAGE_COLOR_BADGE[currentStage.color] ?? STAGE_COLOR_BADGE.zinc,
                )}
              >
                {currentStage.name}
              </span>
            ) : (
              <StageBadge stage={customer.stage} />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Added {formatDate(customer.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!customer.cancelled_at ? (
            <OnTheWayButton customerId={customer.id} />
          ) : null}
          <CancelCustomer
            customerId={customer.id}
            name={customer.full_name}
            cancelled={!!customer.cancelled_at}
          />
        </div>
      </div>

      {customer.cancelled_at ? (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">
            Cancelled{" "}
            <span className="font-normal text-muted-foreground">
              · {formatDate(customer.cancelled_at)}
              {customer.cancel_reason ? ` · ${customer.cancel_reason}` : ""}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This job is out of your active pipeline. Reopen it (top right) to pick
            back up where it left off.
          </p>
        </div>
      ) : null}

      {/* Guided flow — progress + owner/money + the one next step inline.
          (This single hub replaces the old separate command-center.) */}
      {!customer.cancelled_at ? (
        <div className="mb-6">
          <GuidedFlow
            customer={customer}
            stages={stages}
            currentStage={currentStage}
            estimates={estimates}
            jobs={jobs}
            invoices={invoices}
            repOptions={repOptions}
            members={handoffMembers}
            questions={qualifyingQuestions}
            ownerName={ownerName}
            nextActionDue={customer.next_action_due ?? null}
            money={money}
            installPop={installPop}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: stage automations + contact */}
        <div className="space-y-6">
          {customer.qualified ? (
            <Card>
              <CardContent className="flex items-center justify-between gap-3 py-4">
                <div>
                  <div className="text-sm font-medium">Qualification</div>
                  <div className="text-xs text-muted-foreground">
                    Qualified — view the answers on file
                  </div>
                </div>
                <Link
                  href={`/customers/${customer.id}/qualify`}
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                >
                  View
                </Link>
              </CardContent>
            </Card>
          ) : null}

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

          {canDelete ? (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="text-base text-destructive">
                  Danger zone
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Cancel keeps the record. Delete erases the customer and
                  everything attached, for good.
                </p>
                <DeleteCustomer customerId={customer.id} name={customer.full_name} />
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Right: chat + estimates + activity timeline */}
        <div className="space-y-6 lg:col-span-2">
          {/* AI follow-up drafting */}
          {!customer.cancelled_at ? (
            <AiFollowup customerId={customer.id} />
          ) : null}

          {/* Chat */}
          <CustomerChat customerId={customer.id} messages={messages} />

          {/* AI quote drafter */}
          {!customer.cancelled_at ? <AiQuote customerId={customer.id} /> : null}

          {/* Estimates */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Estimates</CardTitle>
              {customer.source ? (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/estimates/smart?customer=${customer.id}`}
                    className={buttonVariants({ size: "sm" })}
                  >
                    <Sparkles className="size-3.5" /> Smart builder
                  </Link>
                  <Link
                    href={`/estimates/new?customer=${customer.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Wizard
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

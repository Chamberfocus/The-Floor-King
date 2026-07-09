import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  StickyNote,
  Phone,
  MessageSquare,
  Mail,
  MapPin,
  Crown,
  CalendarClock,
  AlertTriangle,
  ArrowLeftRight,
  Info,
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
import { listCustomerCheckouts } from "@/lib/data/samples";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { SamplesCard } from "./samples-card";
import { PropertyCard } from "./property-card";
import { CustomerOrdersCard } from "./customer-orders-card";
import { ServiceAddressesCard } from "./service-addresses-card";
import { listServiceAddresses } from "@/lib/data/service-addresses";
import { listCustomerAreas } from "@/lib/data/customer-areas";
import { CustomerAreasCard } from "./areas-card";
import {
  listPurchaseOrdersForCustomer,
  getCustomerStockPulls,
} from "@/lib/data/purchase-orders";
import { getJob, listAssignableUsers, getJobSatisfaction } from "@/lib/data/jobs";
import {
  getSchedulingSettings,
  getInstallerSuggestions,
} from "@/lib/data/scheduling";
import { installDaysForJob } from "@/lib/scheduling";
import { listInstallCrews, getJobCrew } from "@/lib/data/install-crews";
import { InstallSchedule } from "./install-schedule";
import { getJobProgress } from "@/lib/job-progress";
import { JobStepPopup } from "@/components/job-step-popup";
import { CustomerDocuments } from "./customer-documents";
import {
  listWorkflowStages,
  listHandoffMembers,
} from "@/lib/data/workflow";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { createInvoice } from "@/app/(app)/invoices/actions";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { optionTotals } from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import {
  type ActivityType,
  LEAD_SOURCE_LABELS,
  SALES_ROLES,
  INSTALL_ROLES,
  DUTY_ROLES,
  DUTY_LABELS,
  inferStageDuty,
  formatServiceAddress,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatWallTime,
  to12,
  parseArrivalWindows,
} from "@/lib/format";
import { AddActivityForm } from "./add-activity-form";
import { CustomerInfoCard } from "./customer-info-card";
import { CustomerChat } from "./customer-chat";
import { OnTheWayButton } from "./on-the-way-button";
import { GuidedFlow } from "./guided-flow";
import { getCustomerEstimateAppointment } from "@/lib/data/scheduling";
import { SubmitButton } from "@/components/ui/submit-button";
import { CancelCustomer } from "./cancel-customer";
import { AiFollowup } from "./ai-followup";
import {
  CustomerTabs,
  TabGrid,
  TabColumn,
  TabSection,
  TabCollapse,
} from "./customer-tabs";
import { CustomerSettingsMenu } from "./customer-settings-menu";
import { QualifyDialog } from "./qualify-dialog";
import { QuickActions } from "./quick-actions";
import { getUserPreferences } from "@/lib/data/preferences";
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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { id } = await params;
  const justAdded = (await searchParams).new === "1";
  const profile = await requireProfile();
  const prefs = await getUserPreferences();
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
  const customerAreas = await listCustomerAreas(id);
  const [sampleCheckouts, bizSettings, customerPOs, stockPulls, serviceAddresses] =
    await Promise.all([
      listCustomerCheckouts(id),
      getBusinessSettings(),
      listPurchaseOrdersForCustomer(id),
      getCustomerStockPulls(id),
      listServiceAddresses(id),
    ]);
  const stages = await listWorkflowStages();
  const handoffMembers = await listHandoffMembers();
  const qualifyingQuestions = await listQualifyingQuestions({ activeOnly: true });
  // Soonest scheduled install (for the at-a-glance schedule strip under the stage).
  const installJob =
    jobs.find(
      (j) =>
        j.scheduled_date &&
        j.status !== "cancelled" &&
        j.status !== "completed",
    ) ??
    jobs.find((j) => j.scheduled_date) ??
    null;
  // The job the install quick-action targets — the active one (schedulable even
  // if not yet dated), else whatever's on the books.
  const schedulableJob =
    jobs.find((j) => j.status !== "cancelled" && j.status !== "completed") ??
    installJob ??
    jobs[0] ??
    null;
  const names = await getProfileNames([
    ...activities.map((a) => a.user_id ?? ""),
    customer.assigned_to ?? "",
    customer.created_by ?? "",
    customer.workflow_owner_id ?? "",
    installJob?.assigned_to ?? "",
    schedulableJob?.assigned_to ?? "",
  ]);
  const currentStage =
    stages.find((s) => s.id === customer.workflow_stage_id) ?? null;
  const estimateAppointment = await getCustomerEstimateAppointment(id);
  const arrivalWindows = parseArrivalWindows(
    (await getSchedulingSettings()).arrival_windows,
  );

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
  // Only salespeople are offered when picking the rep for an estimate — crew,
  // warehouse, schedulers etc. do other duties and shouldn't clutter the list.
  const repOptions = handoffMembers
    .filter((m) => (SALES_ROLES as string[]).includes(m.role))
    .map((m) => ({ id: m.id, name: m.name }));
  // Quick-actions role scoping: reassign-owner is limited to the duty inferred
  // from the current stage (estimate stages → sales, install → crew, …), and
  // the install picker only offers installers.
  const ownerDuty =
    inferStageDuty(currentStage) ?? currentStage?.owner_duty ?? null;
  const ownerRoles = ownerDuty ? DUTY_ROLES[ownerDuty] : null;
  const reassignOptions = (
    ownerRoles
      ? handoffMembers.filter(
          (m) =>
            (ownerRoles as string[]).includes(m.role) ||
            m.id === customer.workflow_owner_id,
        )
      : handoffMembers
  ).map((m) => ({ id: m.id, name: m.name, title: m.title }));
  const installOptions = handoffMembers
    .filter((m) => (INSTALL_ROLES as string[]).includes(m.role))
    .map((m) => ({ id: m.id, name: m.name }));
  const quickJob = schedulableJob
    ? {
        id: schedulableJob.id,
        date: schedulableJob.scheduled_date ?? null,
        endDate: schedulableJob.scheduled_end ?? null,
        window: schedulableJob.arrival_window ?? null,
        installerId: schedulableJob.assigned_to ?? null,
        installerName: schedulableJob.assigned_to
          ? (names[schedulableJob.assigned_to] ?? null)
          : null,
      }
    : null;
  // The job the guided spine acts on (its satisfaction sign-off feeds the
  // follow-up stage). Mirrors GuidedFlow's own active-job pick.
  const guidedActiveJob =
    jobs.find((j) => j.status !== "completed" && j.status !== "cancelled") ??
    jobs[0] ??
    null;
  const guidedSatisfaction = guidedActiveJob
    ? await getJobSatisfaction(guidedActiveJob.id)
    : null;

  // Install smart-scheduler for the active job — lives here on the customer file
  // (its home). Computed only for the schedulable job to keep the page light.
  let installScheduleProps: Parameters<typeof InstallSchedule>[0] | null = null;
  if (schedulableJob) {
    const [jobDetail, settings, installCrews, jobCrew, assignable] =
      await Promise.all([
        getJob(schedulableJob.id),
        getSchedulingSettings(),
        listInstallCrews({ activeOnly: true }),
        getJobCrew(schedulableJob.id),
        listAssignableUsers(),
      ]);
    const lineItems = jobDetail?.line_items ?? [];
    const est = lineItems.length ? installDaysForJob(lineItems, settings) : null;
    const suggestions =
      est && est.days > 0
        ? await getInstallerSuggestions(lineItems, settings)
        : [];
    // Installers = the canonical INSTALL_ROLES set (matches the smart
    // suggestions, the calendar, and the capacity settings screen).
    const crewUsers = assignable.filter((u) =>
      (INSTALL_ROLES as string[]).includes(u.role),
    );
    const existingCrewNames = new Set(
      installCrews.map((c) => (c.name || "").trim().toLowerCase()),
    );
    const crewOptions = [
      ...installCrews.map((c) => ({
        value: c.id,
        label: `${c.name}${c.kind === "subcontractor" ? " (sub)" : ""}`,
      })),
      ...crewUsers
        .filter((u) => !existingCrewNames.has(u.name.trim().toLowerCase()))
        .map((u) => ({ value: `user:${u.id}`, label: `${u.name} (team installer)` })),
    ];
    installScheduleProps = {
      jobId: schedulableJob.id,
      customerId: id,
      jobTitle: schedulableJob.title ?? null,
      schedule: {
        date: schedulableJob.scheduled_date ?? null,
        endDate: schedulableJob.scheduled_end ?? null,
        window: schedulableJob.arrival_window ?? null,
        installerId: schedulableJob.assigned_to ?? null,
        installerName: schedulableJob.assigned_to
          ? (names[schedulableJob.assigned_to] ?? null)
          : null,
      },
      installEst: est,
      suggestions,
      installerUsers: crewUsers.map((u) => ({ value: u.id, label: u.name })),
      crewOptions,
      currentCrew: jobCrew,
      arrivalWindows,
    };
  }

  // Identity-band bits: address for the maps chip, owner initials, sub line.
  const addressText = [
    customer.street,
    [customer.city, customer.state].filter(Boolean).join(", "),
    customer.zip,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const mapsUrl = addressText
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`
    : null;
  const ownerInitials = ownerName
    ? ownerName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : null;
  const subBits = [
    customer.city && customer.state
      ? `${customer.city}, ${customer.state}`
      : customer.city || customer.state || null,
    customer.source ? LEAD_SOURCE_LABELS[customer.source] : null,
    `Added ${formatDate(customer.created_at)}`,
  ].filter(Boolean) as string[];
  const installWindowLabel = installJob?.arrival_window
    ? installJob.arrival_window
        .split("-")
        .map((s) => to12(s.trim()))
        .join("–")
    : null;
  // "Stuck" = past this stage's time limit (the next-action-due date).
  const overdue =
    !!customer.next_action_due &&
    new Date(customer.next_action_due).getTime() < Date.now();

  return (
    <div className="mx-auto max-w-5xl">
      {schedulableJob ? (
        <JobStepPopup
          jobs={[{ ...getJobProgress(schedulableJob), title: schedulableJob.title }]}
        />
      ) : null}
      <Link
        href="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to customers
      </Link>

      {/* Identity band — who they are, their stage, contact, owner & schedule,
          all in one place (replaces the plain header + its scattered bits). */}
      <section
        id="overview"
        className="relative mb-4 scroll-mt-24 overflow-hidden rounded-lg border bg-card p-5 shadow-sm sm:p-6"
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-primary to-amber-500"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-extrabold tracking-tight sm:text-4xl">
                {customer.full_name}
              </h1>
              {currentStage ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  <Crown className="size-3.5" />
                  {currentStage.name}
                </span>
              ) : (
                <StageBadge stage={customer.stage} />
              )}
              {overdue ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive">
                  <AlertTriangle className="size-3.5" /> Stuck
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
              {subBits.map((t, i) => (
                <span key={t} className="inline-flex items-center gap-2">
                  {i > 0 ? (
                    <span className="size-1 rounded-full bg-muted-foreground/40" />
                  ) : null}
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="text-right leading-tight">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Owner
              </div>
              <div className="text-sm font-semibold">
                {ownerName ?? "Unassigned"}
              </div>
            </div>
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-sm font-bold text-primary-foreground shadow-md">
              {ownerInitials ?? "—"}
            </div>
          </div>
        </div>

        {customer.phone || customer.email || addressText ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {customer.phone ? (
              <a
                href={`tel:${customer.phone}`}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
              >
                <Phone className="size-4 text-muted-foreground" />
                {customer.phone}
              </a>
            ) : null}
            {customer.email ? (
              <a
                href={`mailto:${customer.email}`}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
              >
                <Mail className="size-4 text-muted-foreground" />
                <span className="max-w-[16rem] truncate">{customer.email}</span>
              </a>
            ) : null}
            {addressText && mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary"
              >
                <MapPin className="size-4 text-muted-foreground" />
                <span className="max-w-[18rem] truncate">{addressText}</span>
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <CustomerSettingsMenu
            customer={customer}
            canDelete={canDelete}
            portalUser={portalUser}
            defaultEmail={customer.email ?? ""}
          />
          <QualifyDialog
            customerId={customer.id}
            questions={qualifyingQuestions}
            qualified={!!customer.qualified}
            autoOpen={justAdded}
          />
          {!customer.cancelled_at ? (
            <OnTheWayButton customerId={customer.id} />
          ) : null}
          <div className="ml-auto">
            <CancelCustomer
              customerId={customer.id}
              name={customer.full_name}
              cancelled={!!customer.cancelled_at}
            />
          </div>
        </div>
      </section>

      {!customer.cancelled_at ? (
        <QuickActions
          customerId={customer.id}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          currentStageId={currentStage?.id ?? null}
          currentStageName={currentStage?.name ?? null}
          currentOwnerId={customer.workflow_owner_id ?? null}
          currentOwnerName={ownerName}
          assignedRepId={customer.assigned_to ?? null}
          ownerDutyLabel={ownerDuty ? DUTY_LABELS[ownerDuty] : null}
          reassignOptions={reassignOptions}
          repOptions={repOptions}
          installOptions={installOptions}
          estimate={
            estimateAppointment
              ? {
                  startsAt: estimateAppointment.startsAt,
                  rep: estimateAppointment.salespersonName ?? null,
                }
              : null
          }
          job={quickJob}
          arrivalWindows={arrivalWindows}
          actions={prefs.quickActions}
        />
      ) : null}

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

      {/* Hybrid tabs: Overview shows the whole file; each tab zooms into one part. */}
      <CustomerTabs
        tabs={prefs.tabs}
        defaultTab={prefs.defaultTab}
        counts={{
          estimates: estimates.length,
          jobs: jobs.length,
          invoices: invoices.length,
          materials: customerPOs.length + stockPulls.length,
          files: documents.length,
          messages: messages.length,
        }}
      >
        {/* Guided flow — progress + owner/money + the one next step inline. */}
        {!customer.cancelled_at ? (
          <TabSection tab="overview">
            <div className="mb-6 grid gap-6 lg:grid-cols-3">
              {/* Left: the guided "do this next" hero + progress */}
              <div className="lg:col-span-2">
                <GuidedFlow
                  customer={customer}
                  stages={stages}
                  currentStage={currentStage}
                  estimates={estimates}
                  jobs={jobs}
                  invoices={invoices}
                  repOptions={repOptions}
                  installScheduleProps={installScheduleProps}
                  jobSatisfaction={guidedSatisfaction}
                />
              </div>

              {/* Right: money + due rail */}
              <aside className="space-y-4">
                <div className="rounded-lg border bg-card p-5 shadow-sm">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Money
                  </p>
                  {money.invoiced > 0 || money.balance > 0 ? (
                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Invoiced</span>
                        <span className="font-semibold tabular-nums">
                          {formatMoney(money.invoiced)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Paid</span>
                        <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatMoney(money.paid)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500"
                          style={{
                            width: `${
                              money.invoiced > 0
                                ? Math.min(
                                    100,
                                    Math.round(
                                      (money.paid / money.invoiced) * 100,
                                    ),
                                  )
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between border-t pt-2.5">
                        <span className="text-muted-foreground">Balance</span>
                        <span
                          className={cn(
                            "font-bold tabular-nums",
                            money.balance > 0.005 && "text-destructive",
                          )}
                        >
                          {formatMoney(money.balance)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No invoices yet.
                    </p>
                  )}
                </div>

                {estimateAppointment || installJob?.scheduled_date ? (
                  <div className="rounded-lg border bg-card p-5 shadow-sm">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Schedule
                    </p>
                    <div className="space-y-3.5">
                      {estimateAppointment ? (
                        <div className="flex items-start gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <CalendarClock className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Estimate
                            </div>
                            <div className="text-sm font-semibold">
                              {formatDate(estimateAppointment.startsAt)} ·{" "}
                              {formatWallTime(estimateAppointment.startsAt)}
                            </div>
                            {estimateAppointment.salespersonName ? (
                              <div className="text-xs text-muted-foreground">
                                with {estimateAppointment.salespersonName}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {installJob?.scheduled_date ? (
                        <div className="flex items-start gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <Wrench className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Install
                            </div>
                            <div className="text-sm font-semibold">
                              {formatDate(installJob.scheduled_date)}
                              {installWindowLabel ? ` · ${installWindowLabel}` : ""}
                            </div>
                            {installJob.assigned_to &&
                            names[installJob.assigned_to] ? (
                              <div className="text-xs text-muted-foreground">
                                {names[installJob.assigned_to]}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {customer.next_action_due ? (
                  <div className="rounded-lg border bg-card p-5 shadow-sm">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Next action due
                    </p>
                    <p className="text-sm font-semibold">
                      {formatDateTime(customer.next_action_due)}
                    </p>
                  </div>
                ) : null}
              </aside>
            </div>
          </TabSection>
        ) : null}

        <TabGrid>
        {/* Left: stage automations + contact */}
        <TabColumn show={["overview", "contact"]} className="space-y-6">
          <TabSection tab="contact">
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
          </TabSection>

          <TabSection tab="contact">
            <CustomerInfoCard customer={customer} />
          </TabSection>

          <TabSection tab="contact">
            <PropertyCard
              customer={customer}
              hasMaps={!!process.env.GOOGLE_MAPS_API_KEY}
              hasPropertyApi={!!process.env.RENTCAST_API_KEY}
            />
          </TabSection>

          <TabSection tab="contact">
            <ServiceAddressesCard
              customerId={customer.id}
              addresses={serviceAddresses}
            />
          </TabSection>
        </TabColumn>

        {/* Right: chat + estimates + activity timeline */}
        <TabColumn
          show={["overview", "estimates", "jobs", "invoices", "materials", "files", "messages", "activity"]}
          className="space-y-6 lg:col-span-2"
        >
          {/* AI follow-up drafting */}
          {!customer.cancelled_at ? (
            <TabCollapse tab="overview" title="AI follow-up draft">
              <AiFollowup customerId={customer.id} />
            </TabCollapse>
          ) : null}

          {/* Chat */}
          <TabCollapse tab="messages" title={`Messages${messages.length ? ` (${messages.length})` : ""}`}>
            <CustomerChat customerId={customer.id} messages={messages} />
          </TabCollapse>

          {/* Estimates */}
          <TabSection tab="estimates">
          <Card id="estimates" className="scroll-mt-24">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Estimates</CardTitle>
              {customer.source ? (
                <Link
                  href={`/estimates/smart?customer=${customer.id}`}
                  className={buttonVariants({ size: "sm" })}
                >
                  <Sparkles className="size-3.5" /> Build estimate
                </Link>
              ) : (
                <span className="text-xs font-medium text-amber-600">
                  Set a lead source (Edit) to create estimates
                </span>
              )}
            </CardHeader>
            <CardContent>
              {estimates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No estimates yet. Click &ldquo;Build estimate&rdquo; to build a quote.
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
          </TabSection>

          {/* Samples */}
          <TabSection tab="overview">
            <SamplesCard
              customerId={customer.id}
              checkouts={sampleCheckouts}
              loanDays={bizSettings.sample_loan_days}
              defaultDeposit={bizSettings.sample_default_deposit}
              maxOut={bizSettings.sample_max_out}
            />
          </TabSection>

          {/* Jobs */}
          <TabSection tab="jobs">
          <Card id="jobs" className="scroll-mt-24">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Jobs</CardTitle>
              <form action={createJob} className="flex items-center gap-2">
                <input type="hidden" name="customer_id" value={customer.id} />
                {serviceAddresses.length > 0 ? (
                  <select
                    name="service_address_id"
                    className="h-9 max-w-[10rem] rounded-md border border-input bg-transparent px-2 text-xs"
                    aria-label="Job site address"
                  >
                    <option value="">Primary address</option>
                    {serviceAddresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label || formatServiceAddress(a)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <SubmitButton size="sm" pendingText="Creating…" confirm="Job created">
                  <Wrench className="size-3.5" /> New job
                </SubmitButton>
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
          </TabSection>

          {/* Materials & Orders — POs + stock for this customer */}
          <TabSection tab="materials">
            <CustomerOrdersCard
              customerId={customer.id}
              pos={customerPOs}
              stockPulls={stockPulls}
            />
          </TabSection>

          {/* Invoices */}
          <TabSection tab="invoices">
          <Card id="invoices" className="scroll-mt-24">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Invoices</CardTitle>
              <form action={createInvoice}>
                <input type="hidden" name="customer_id" value={customer.id} />
                <SubmitButton size="sm" pendingText="Creating…" confirm="Invoice created">
                  <Receipt className="size-3.5" /> New invoice
                </SubmitButton>
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
          </TabSection>

          {/* Photos & files */}
          <TabCollapse
            tab="files"
            title={`Photos & files${documents.length ? ` (${documents.length})` : ""}`}
            defaultOpen={documents.length > 0}
          >
            <CustomerDocuments customerId={customer.id} documents={documents} />
          </TabCollapse>

          <CustomerAreasCard customerId={customer.id} areas={customerAreas} />

          {/* Activity */}
          <TabCollapse tab="activity" title="Activity history">
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
          </TabCollapse>
        </TabColumn>
        </TabGrid>
      </CustomerTabs>
    </div>
  );
}

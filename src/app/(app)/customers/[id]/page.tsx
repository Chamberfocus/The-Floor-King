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
  CalendarClock,
  AlertTriangle,
  ArrowLeftRight,
  Info,
  Wrench,
  Check,
  Boxes,
  Receipt,
  Sparkles,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { createEstimate } from "@/app/(app)/estimates/actions";
import { StageBadge } from "@/components/stage-badge";
import {
  getCustomer,
  listActivities,
  getProfileNames,
  getPortalUser,
} from "@/lib/data/customers";
import { listEstimatesForCustomer } from "@/lib/data/estimates";
import { listJobsForCustomer } from "@/lib/data/jobs";
import {
  createJobFromEstimate,
  submitJobToWarehouse,
} from "@/app/(app)/jobs/actions";
import { listInvoicesForCustomer, amountPaid } from "@/lib/data/invoices";
import { listCustomerMessages } from "@/lib/data/messages";
import { listCustomerDocuments } from "@/lib/data/documents";
import { listCustomerCheckouts } from "@/lib/data/samples";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getOrgSettings } from "@/lib/data/org";
import { ProcessCardButton } from "./process-card-button";
import { SamplesCard } from "./samples-card";
import { PropertyCard } from "./property-card";
import { CustomerOrdersCard } from "./customer-orders-card";
import { ServiceAddressesCard } from "./service-addresses-card";
import { listServiceAddresses } from "@/lib/data/service-addresses";
import { listCustomerAreas } from "@/lib/data/customer-areas";
import { CustomerAreasCard } from "./areas-card";
import {
  listPurchaseOrdersForCustomer,
  listAttributedPoItemsForCustomer,
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
import { listInstallPreferences } from "@/lib/data/install-availability";
import { CustomerDocuments } from "./customer-documents";
import {
  listWorkflowStages,
  listHandoffMembers,
} from "@/lib/data/workflow";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { createInvoice } from "@/app/(app)/invoices/actions";
import { optionTotals, lineTotal } from "@/lib/estimate-calc";
import { buildJobScope } from "@/lib/job-scope";
import {
  EstimateRow,
  WorkOrderRow,
  InvoiceRow,
  type EstimateRowData,
  type WorkOrderRowData,
  type InvoiceRowData,
} from "./customer-record-rows";
import { invoiceTotals } from "@/lib/invoice-calc";
import {
  type ActivityType,
  type EstimateLineItem,
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
import { JobRollUp } from "./job-roll-up";
import { MarkContacted } from "./mark-contacted";
import { buildChecklistSlots } from "@/components/checklist-slots";
import { getCustomerChecklists } from "@/lib/data/job-checklists";
import { getCustomerEstimateAppointment } from "@/lib/data/scheduling";
import { SubmitButton } from "@/components/ui/submit-button";
import { setEstimateStatus } from "@/app/(app)/estimates/actions";
import { CancelCustomer } from "./cancel-customer";
import { listCancelReasons } from "@/lib/data/cancel-reasons";
import { AiFollowup } from "./ai-followup";
import {
  CustomerTabs,
  TabGrid,
  TabColumn,
  TabSection,
  TabCollapse,
} from "./customer-tabs";
import { CustomerSettingsMenu } from "./customer-settings-menu";
import { listLeadSources } from "@/lib/data/lead-sources";
import { NewEstimate } from "@/components/new-estimate";
import { QualifyDialog } from "./qualify-dialog";
import { QuickActions } from "./quick-actions";
import { CustomerSwitcher } from "./customer-switcher";
import { DocumentShortcuts, type DocJob } from "./document-shortcuts";
import { getCustomerJobCosting } from "@/lib/data/job-costing";
import { getJobProfitability } from "@/lib/data/finance";
import { JobCostingTab, type JobProfitLite } from "./job-costing-tab";
import { HistoryTab } from "./history-tab";
import { getCustomerHistory } from "@/lib/data/customer-history";
import { getUserPreferences } from "@/lib/data/preferences";
import { pickCloseoutJob,
  spinePosition,
} from "@/lib/job-flow";
import { STEP_OVERRIDE_ROLES } from "@/lib/job-checklist";
import { createClient } from "@/lib/supabase/server";
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
  searchParams: Promise<{ new?: string; schedule?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const justAdded = sp.new === "1";
  // The checklist links straight AT the scheduler ("?schedule=estimate"), so
  // step two opens the booking dialog instead of dropping you on the page that
  // happens to contain it.
  const openScheduler =
    sp.schedule === "estimate" || sp.schedule === "install" ? sp.schedule : null;
  const profile = await requireProfile();
  const prefs = await getUserPreferences();
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const canDelete = profile.role === "admin" || profile.role === "office";
  const leadSources = await listLeadSources({ activeOnly: true });
  // Whether the lead source (+ its required sub-detail) is recorded — gates
  // estimate creation with an inline prompt rather than a redirect.
  const _src = leadSources.find((s) => s.id === customer.source_id);
  const sourceOk =
    !!customer.source_id &&
    (!_src?.detail_required ||
      (_src.detail_mode === "referrer"
        ? !!(customer.source_detail_text || customer.referred_by_customer_id)
        : !!(customer.source_detail_id || customer.source_detail_text)));

  const activities = await listActivities(id);
  const estimates = await listEstimatesForCustomer(id);
  const jobs = await listJobsForCustomer(id);
  const invoices = await listInvoicesForCustomer(id);
  const portalUser = await getPortalUser(id);
  const messages = await listCustomerMessages(id);
  const documents = await listCustomerDocuments(id);
  const customerAreas = await listCustomerAreas(id);
  const [sampleCheckouts, bizSettings, customerPOs, stockPulls, serviceAddresses, attributedPoLines, orgSettings] =
    await Promise.all([
      listCustomerCheckouts(id),
      getBusinessSettings(),
      listPurchaseOrdersForCustomer(id),
      getCustomerStockPulls(id),
      listServiceAddresses(id),
      listAttributedPoItemsForCustomer(id),
      getOrgSettings(),
    ]);
  const stages = await listWorkflowStages();
  const handoffMembers = await listHandoffMembers();
  // Read-only per-job estimated-vs-actual costing for the Job Costing tab.
  const costing = await getCustomerJobCosting(id);
  const history = await getCustomerHistory(id);

  // Owner-only real profit breakdown (revenue − material/labor/other + the
  // internal fuel/car/commission), keyed by job for the "cost vs profit" popup.
  // Uses the ONE source of truth (getJobProfitability) so it matches the
  // dashboard/scorecard exactly. Never computed for non-owners.
  const jobProfit: Record<string, JobProfitLite> = {};
  if (profile.role === "admin" && costing.rows.length) {
    const ids = new Set(costing.rows.map((r) => r.jobId));
    for (const jp of await getJobProfitability()) {
      if (!ids.has(jp.jobId)) continue;
      jobProfit[jp.jobId] = {
        revenue: jp.revenue,
        revenueIsActual: jp.revenueIsActual,
        billed: jp.billed,
        quotedRevenue: jp.quotedRevenue,
        materialCost: jp.materialCost,
        laborCost: jp.laborCost,
        otherCost: jp.otherCost,
        fuelCost: jp.fuelCost,
        carCost: jp.carCost,
        commissionCost: jp.commissionCost,
        cost: jp.cost,
        profit: jp.profit,
        margin: jp.margin,
      };
    }
  }
  // Manageable cancellation reasons for the Cancel dialog.
  const cancelReasons = await listCancelReasons({ activeOnly: true });
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
    ...jobs.map((j) => j.assigned_to ?? ""),
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
  // "Stage 6 of 12" — where they are on the linear spine, so the badge means
  // something without knowing the stage list by heart.
  const spinePos = spinePosition(currentStage, stages);
  const ownerName = customer.workflow_owner_id
    ? (names[customer.workflow_owner_id] ?? null)
    : null;
  // For the at-a-glance details block.
  const salespersonName = customer.assigned_to
    ? (names[customer.assigned_to] ?? null)
    : null;
  const sourceLabel =
    leadSources.find((s) => s.id === customer.source_id)?.label ??
    (customer.source ? LEAD_SOURCE_LABELS[customer.source] : null);

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
  // Which job the close-out action opens — the SAME rule the customer list
  // uses, so the two surfaces never point at different jobs.
  const closeoutTarget = pickCloseoutJob(
    jobs.map((j) => ({
      id: j.id,
      status: j.status ?? null,
      scheduled_date: j.scheduled_date ?? null,
      closed_out_at: j.closed_out_at ?? null,
    })),
  );
  const canCloseOut = ["admin", "office", "sales_manager"].includes(
    profile.role,
  );
  // The job the guided spine acts on (its satisfaction sign-off feeds the
  // follow-up stage). Mirrors GuidedFlow's own active-job pick.
  const guidedActiveJob =
    jobs.find((j) => j.status !== "completed" && j.status !== "cancelled") ??
    jobs[0] ??
    null;
  const guidedSatisfaction = guidedActiveJob
    ? await getJobSatisfaction(guidedActiveJob.id)
    : null;
  /**
   * One checklist PER JOB.
   *
   * This page used to build a single checklist and pick "the" job for it — the
   * oldest unfinished one. With one job that's invisible; with two it silently
   * tracks the wrong one. The account is the account; the work is the job.
   * Every step, and the tools to do it, now live on the job page.
   */
  const jobChecklists = await getCustomerChecklists(id);
  /** Step one is an ACCOUNT fact — has anyone actually spoken to these people —
   *  so it reads the same on every job's list. Once it's true the one-click
   *  "Mark contacted" comes off; the Activity tab is the way to add more. */
  const contactLogged = jobChecklists.some((j) =>
    j.steps.some((s) => s.key === "contact" && s.state === "done"),
  );

  /**
   * The one-click steps, on the list you're already reading.
   *
   * Send the quote, mark it approved, hand it to the warehouse, say the install
   * is done — each of those used to mean opening the estimate, the work order or
   * the warehouse board, pressing one button, and finding your own way back.
   * Same shared builder the work order uses, so a step can't offer one action
   * here and a different one there.
   */
  /**
   * Only when this account has ONE piece of work.
   *
   * The roll-up draws a checklist per job, but actionSlots is one set shared by
   * all of them — so on an account with two jobs a "Send it" button built from
   * "the account's newest estimate" would sit on the wrong job's row and act on
   * the wrong record. Rare, silent, and the worst kind of wrong.
   *
   * With one job there's no ambiguity, which covers almost every account. With
   * more, the buttons are left off and the steps keep their links — the work
   * order carries the exact per-job buttons anyway, because it knows which job
   * it is.
   */
  const singleWork = jobChecklists.length === 1;
  const liveJob = jobs.find((j) => j.status !== "cancelled") ?? null;
  const liveEstimate =
    estimates.find((e) => e.status === "sent") ??
    estimates.find((e) => e.status === "draft") ??
    estimates.find((e) => e.status === "approved") ??
    null;
  const checklistSlots: Record<string, React.ReactNode> = {
    ...(singleWork
      ? buildChecklistSlots({
          estimate: liveEstimate
            ? { id: liveEstimate.id, status: liveEstimate.status }
            : null,
          job: liveJob
            ? {
                id: liveJob.id,
                status: liveJob.status ?? null,
                warehouseSubmittedAt: liveJob.warehouse_submitted_at ?? null,
              }
            : null,
          backTo: `/customers/${id}`,
        })
      : {}),
    ...(contactLogged ? {} : { contact: <MarkContacted customerId={id} /> }),
  };


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
    // ONE unified installer list — login installers (→ assigned_to) + login-less
    // subcontractor crews (value "crew:<id>" → assigned_crew_id). Matches the
    // shared buildInstallScheduleProps.
    const installerUsers = [
      ...crewUsers.map((u) => ({ value: u.id, label: u.name })),
      ...installCrews
        .filter((c) => !c.profile_id)
        .map((c) => ({ value: `crew:${c.id}`, label: `${c.name} (sub)` })),
    ];
    installScheduleProps = {
      jobId: schedulableJob.id,
      customerId: id,
      jobTitle: schedulableJob.title ?? null,
      schedule: {
        date: schedulableJob.scheduled_date ?? null,
        endDate: schedulableJob.scheduled_end ?? null,
        window: schedulableJob.arrival_window ?? null,
        installerId: schedulableJob.assigned_to
          ? schedulableJob.assigned_to
          : schedulableJob.assigned_crew_id
            ? `crew:${schedulableJob.assigned_crew_id}`
            : null,
        installerName: schedulableJob.assigned_to
          ? (names[schedulableJob.assigned_to] ?? null)
          : (jobCrew?.name ?? null),
      },
      installEst: est,
      suggestions,
      installerUsers,
      arrivalWindows,
      preferences: (await listInstallPreferences(schedulableJob.id)).map(
        (p) => p.preferred_date,
      ),
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
    leadSources.find((s) => s.id === customer.source_id)?.label ??
      (customer.source ? LEAD_SOURCE_LABELS[customer.source] : null),
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

  // --- In-context record rows: click any estimate / work order / invoice to
  //     expand it in place (never leave the customer). Data is already loaded. ---
  // Pull each work order's line items straight from its option (robust even if
  // the estimate isn't in this customer's list), so the inline installation
  // scope is never wrongly empty.
  const optionLines = new Map<string, EstimateLineItem[]>();
  const jobOptionIds = [...new Set(jobs.map((j) => j.option_id).filter(Boolean) as string[])];
  if (jobOptionIds.length) {
    const supabase = await createClient();
    const { data: jobLines } = await supabase
      .from("estimate_line_items")
      .select("*")
      .in("option_id", jobOptionIds)
      .order("position", { ascending: true });
    for (const l of (jobLines ?? []) as EstimateLineItem[]) {
      const arr = optionLines.get(l.option_id) ?? [];
      arr.push(l);
      optionLines.set(l.option_id, arr);
    }
  }

  /**
   * Which property each estimate is for.
   *
   * Shown as soon as the account has ANY named property, not only when it has
   * two. With one property and several estimates, "Unit 813" against one row
   * and "Account address" against the others is exactly the distinction you
   * need; a homeowner with no properties still sees nothing.
   */
  const addrLabel = new Map(
    serviceAddresses.map((a) => [
      a.id,
      a.label || formatServiceAddress(a) || "Property",
    ]),
  );
  const showSites = serviceAddresses.length > 0;
  const estimateRows: EstimateRowData[] = estimates.map((e) => {
    const opts = e.options ?? [];
    const opt =
      (e.accepted_option_id && opts.find((o) => o.id === e.accepted_option_id)) || opts[0];
    const lines = opt?.line_items ?? [];
    return {
      id: e.id,
      title: e.title || "Estimate",
      status: e.status,
      total: opt ? optionTotals(lines, e.tax_rate).total : 0,
      optionName: opts.length > 1 ? (opt?.name ?? null) : null,
      siteLabel: showSites
        ? (addrLabel.get(
            (e as { service_address_id?: string | null }).service_address_id ?? "",
          ) ?? "Account address")
        : null,
      lines: lines.map((l) => ({
        id: l.id,
        label: [l.room, l.description].filter(Boolean).join(" — ") || "Line item",
        amount: lineTotal(l),
      })),
    };
  });

  const workOrderRows: WorkOrderRowData[] = jobs.map((j) => ({
    id: j.id,
    title: j.title || "Job",
    status: j.status,
    scheduledDate: j.scheduled_date ?? null,
    crewName: j.assigned_to ? (names[j.assigned_to] ?? null) : null,
    showPrices: !!j.show_prices,
    scope: buildJobScope(
      j.option_id ? (optionLines.get(j.option_id) ?? []) : [],
      j.notes ?? null,
    ),
  }));

  // One-click document shortcuts: each job resolves its four printable docs from
  // the REAL records — its work order & staging sheet (the job), its source
  // estimate (job.estimate_id, else the customer's latest), and the invoice tied
  // to it. No job yet → estimate/invoice fall back to the customer's latest.
  const docJobs: DocJob[] = jobs.map((j) => ({
    id: j.id,
    label: j.title || `Job · ${formatDate(j.scheduled_date ?? j.created_at)}`,
    estimateId: (j.estimate_id as string | null) ?? estimates[0]?.id ?? null,
    invoiceId: invoices.find((inv) => inv.job_id === j.id)?.id ?? null,
  }));
  const fallbackEstimateId = estimates[0]?.id ?? null;
  const fallbackInvoiceId = invoices[0]?.id ?? null;

  const invoiceRows: InvoiceRowData[] = invoices.map((inv) => {
    const t = invoiceTotals(inv.items ?? [], inv.tax_rate, amountPaid(inv));
    return {
      id: inv.id,
      number: inv.number || "Invoice",
      status: inv.status,
      balance: t.balance,
      total: t.total,
      paid: amountPaid(inv),
      lines: (inv.items ?? []).map((it) => ({
        id: it.id,
        label: it.description || "Item",
        amount: (Number(it.quantity) || 0) * (Number(it.rate) || 0),
      })),
    };
  });

  return (
    <div className="mx-auto max-w-5xl">
      {/* The checklist is the single source of "where this job
          is" on the dashboard — the job-status next-step popup lived here too and
          could show a second, conflicting progression, so it's removed. It still
          appears on the job & installer pages, which have no spine. */}
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
              <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
                {customer.full_name}
              </h1>
              {/* The stage, stated loudly, on every tab. It used to be kept
                  deliberately quiet so it wouldn't compete with the guided
                  hero — but that hero is gone, and "what stage is this client
                  in" is the first thing you want to know on opening the file. */}
              {currentStage ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow-sm">
                  {currentStage.name}
                  {spinePos.index >= 0 && spinePos.total ? (
                    <span className="font-medium opacity-75">
                      {spinePos.index + 1}/{spinePos.total}
                    </span>
                  ) : null}
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
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <span>{addressText}</span>
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
            sources={leadSources}
          />
          <QualifyDialog
            customerId={customer.id}
            questions={qualifyingQuestions}
            qualified={!!customer.qualified}
            autoOpen={justAdded}
          />
          {/* ONE action area: settings, qualify, on-my-way, and the quick
              stage/owner/estimate/install actions — merged into a single row so
              there aren't three stacked control bands. The quick actions show no
              value labels here (showValues=false) because each value has its own
              home on the page (stage → hero, owner → header, dates → Schedule). */}
          {!customer.cancelled_at ? (
            <>
              <OnTheWayButton
                customerId={customer.id}
                customerName={customer.full_name}
                customerEmail={customer.email}
              />
              {(SALES_ROLES as string[]).includes(profile.role) ? (
                <ProcessCardButton
                  url={orgSettings.card_processing_url}
                  customerId={customer.id}
                  clientName={customer.full_name}
                  balance={money.balance}
                  isAdmin={profile.role === "admin"}
                />
              ) : null}
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
                closeout={closeoutTarget}
                canCloseOut={canCloseOut}
                arrivalWindows={arrivalWindows}
                actions={prefs.quickActions}
                installScheduler={
                  installScheduleProps ? <InstallSchedule {...installScheduleProps} /> : null
                }
                openOnLoad={openScheduler}
                compact
                showValues={false}
                showSwitcher={false}
              />

              {/* Start new work for an existing customer. Both of these already
                  existed, buried in the Estimates and Jobs tabs — which is the
                  last place you look when a repeat customer rings up about a
                  second room. Same controls, hoisted to where they're seen. */}
              <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              {/* One button, all four ways in — including copying their last
                  quote, which used to be offered only on /estimates/start and
                  never here, on the file of the repeat customer it's for. */}
              <NewEstimate
                customerId={customer.id}
                sourceOk={sourceOk}
                sources={leadSources}
              />
              {/* This used to post straight to `createJob`, which made a work
                  order literally titled "Job" with nothing on it and dropped you
                  on the work order to fill in the blanks — the roll-up then
                  flagged the result as a stray click, safe to delete. It now
                  opens the real form: what the work is, which site, and the
                  option to hang it off an estimate that already exists. */}
              <Link
                href={`/jobs/new?customer=${customer.id}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <Wrench className="size-3.5" /> New job
              </Link>
            </>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {!customer.cancelled_at ? (
              <CustomerSwitcher currentId={customer.id} />
            ) : null}
            <CancelCustomer
              customerId={customer.id}
              name={customer.full_name}
              cancelled={!!customer.cancelled_at}
              reasons={cancelReasons}
              hasOpenPO={customerPOs.some((po) => po.status === "ordered")}
            />
          </div>
        </div>
      </section>

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

      {/* Hybrid tabs: Overview shows the whole file; each tab zooms into one part.
          Saved tab orders are treated as exhaustive (see resolvePreferences), so
          tabs added AFTER someone customised theirs would silently never appear.
          Costing and History are both newer than that setting — patch them in. */}
      <CustomerTabs
        tabs={["costing", "history"].reduce(
          (acc, k) => (acc.includes(k as never) ? acc : [...acc, k as never]),
          prefs.tabs,
        )}
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
        {/* Overview — the checklist, the documents, and the money rail. */}
        {!customer.cancelled_at ? (
          <TabSection tab="overview">
            <div className="mb-6 grid gap-6 lg:grid-cols-3">
              {/* Left: the guided "do this next" hero + progress */}
              <div className="lg:col-span-2">
                {/* The checklist: the whole path, clickable at any point, with
                    the stage said out loud at the top. */}
                <div className="mb-6">
                  <JobRollUp
                    customerId={id}
                    jobs={jobChecklists}
                    stageName={currentStage?.name ?? null}
                    stagePosition={spinePos.index >= 0 ? spinePos.index + 1 : null}
                    stageTotal={spinePos.total || null}
                    ownerName={ownerName}
                    actionSlots={checklistSlots}
                    canOverride={STEP_OVERRIDE_ROLES.includes(profile.role)}
                  />
                </div>
                {/* The old GuidedFlow panel lived here: one step at a time,
                    755 lines of bespoke UI, and no way to see where the job had
                    got to. The checklist above replaces it — every step, every
                    link, and the stage stated plainly. The tools it used to
                    host inline are all one click away: Stage / Assignee /
                    Estimate / Install sit in Quick actions, approving lives on
                    the estimate, collecting on the invoice. */}

                {/* One click to open/print the four key documents for this
                    customer's job (pick the job if there's more than one). */}
                <DocumentShortcuts
                  jobs={docJobs}
                  fallbackEstimateId={fallbackEstimateId}
                  fallbackInvoiceId={fallbackInvoiceId}
                />
              </div>

              {/* Right: details + money + due rail. (Record counts live on the
                  tabs, so the old "Records" snapshot panel was removed.) */}
              <aside className="space-y-4">
                {/* Full customer details, at a glance — no Contact-tab hunting. */}
                <div className="rounded-lg border bg-card p-5 shadow-sm">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Customer details
                  </p>
                  <div className="space-y-3 text-sm">
                    <div className="space-y-2">
                      {customer.phone ? (
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-muted-foreground">Phone</span>
                          <a href={`tel:${customer.phone}`} className="font-medium hover:text-primary">
                            {customer.phone}
                          </a>
                        </div>
                      ) : null}
                      {customer.email ? (
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="shrink-0 text-muted-foreground">Email</span>
                          <a
                            href={`mailto:${customer.email}`}
                            className="truncate font-medium hover:text-primary"
                          >
                            {customer.email}
                          </a>
                        </div>
                      ) : null}
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-muted-foreground">Heard via</span>
                        <span className="text-right font-medium">{sourceLabel ?? "—"}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-muted-foreground">Added</span>
                        <span className="font-medium">{formatDate(customer.created_at)}</span>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-muted-foreground">Salesperson</span>
                        <span className="text-right font-medium">
                          {salespersonName ?? "Unassigned"}
                        </span>
                      </div>
                    </div>
                    {addressText ? (
                      <div className="border-t pt-2.5">
                        <div className="text-xs text-muted-foreground">Address</div>
                        <div className="font-medium">{addressText}</div>
                      </div>
                    ) : null}
                    {serviceAddresses.length ? (
                      <div className="border-t pt-2.5">
                        <div className="text-xs text-muted-foreground">
                          Job site{serviceAddresses.length > 1 ? "s" : ""}
                        </div>
                        {serviceAddresses.map((a) => (
                          <div key={a.id} className="font-medium">
                            {a.label ? `${a.label}: ` : ""}
                            {formatServiceAddress(a)}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {customer.notes ? (
                      <div className="border-t pt-2.5">
                        <div className="text-xs text-muted-foreground">Notes</div>
                        <div className="whitespace-pre-wrap">{customer.notes}</div>
                      </div>
                    ) : null}
                  </div>
                </div>

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
        {/* Left: contact & property (its own tab — Overview stays a summary) */}
        <TabColumn show={["contact"]} className="space-y-6">
          <TabSection tab="contact" overview={false}>
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

          <TabSection tab="contact" overview={false}>
            <CustomerInfoCard customer={customer} sources={leadSources} />
          </TabSection>

          <TabSection tab="contact" overview={false}>
            <PropertyCard
              customer={customer}
              hasMaps={!!process.env.GOOGLE_MAPS_API_KEY}
              hasPropertyApi={!!process.env.RENTCAST_API_KEY}
            />
          </TabSection>

          <TabSection tab="contact" overview={false}>
            <ServiceAddressesCard
              customerId={customer.id}
              addresses={serviceAddresses}
            />
          </TabSection>
        </TabColumn>

        {/* Right: the records — one focused section per tab */}
        <TabColumn
          show={["estimates", "jobs", "costing", "invoices", "materials", "files", "messages", "activity"]}
          className="space-y-6 lg:col-span-2"
        >
          {/* Job Costing — read-only estimated vs actual, per job (off Overview) */}
          <TabSection tab="costing" overview={false}>
            <JobCostingTab data={costing} profit={jobProfit} />
          </TabSection>

          {/* History — every estimate, job, invoice and payment in time order,
              grouped by property. The view a commercial account needs. */}
          <TabSection tab="history" overview={false}>
            <HistoryTab history={history} />
          </TabSection>

          {/* Chat + AI follow-up draft — Messages tab */}
          <TabCollapse
            tab="messages"
            title={`Messages${messages.length ? ` (${messages.length})` : ""}`}
          >
            <CustomerChat
              customerId={customer.id}
              customerName={customer.full_name}
              customerEmail={customer.email}
              messages={messages}
            />
          </TabCollapse>
          {!customer.cancelled_at ? (
            <TabCollapse tab="messages" title="AI follow-up draft">
              <AiFollowup customerId={customer.id} />
            </TabCollapse>
          ) : null}

          {/* Estimates */}
          <TabSection tab="estimates" overview={false}>
          <Card id="estimates" className="scroll-mt-24">
            {/* No create buttons here — they moved to the header bar, which is
                visible from every tab. Two identical pairs on one screen is
                what "confusing" looks like. */}
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-base">Estimates</CardTitle>
            </CardHeader>
            <CardContent>
              {estimateRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No estimates yet — use &ldquo;Guided questionnaire&rdquo; or
                  &ldquo;Build estimate&rdquo; at the top of this page.
                </p>
              ) : (
                <div className="space-y-2">
                  {estimateRows.map((e) => (
                    <EstimateRow
                      key={e.id}
                      e={e}
                      customerId={customer.id}
                      customerName={customer.full_name}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          </TabSection>

          {/* Samples — a sales tool, lives under Contact (off Overview) */}
          <TabSection tab="contact" overview={false}>
            <SamplesCard
              customerId={customer.id}
              checkouts={sampleCheckouts}
              loanDays={bizSettings.sample_loan_days}
              defaultDeposit={bizSettings.sample_default_deposit}
              maxOut={bizSettings.sample_max_out}
            />
          </TabSection>

          {/* Work orders (jobs) */}
          <TabSection tab="jobs" overview={false}>
          <Card id="jobs" className="scroll-mt-24">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {workOrderRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No jobs yet — use &ldquo;New job&rdquo; at the top of this page,
                  or create one from an approved estimate.
                </p>
              ) : (
                <div className="space-y-2">
                  {workOrderRows.map((j) => (
                    <WorkOrderRow key={j.id} j={j} />
                  ))}
                </div>
              )}
              {/* Measurements belong with the work — moved here so it stops
                  leaking onto every tab. */}
              <CustomerAreasCard customerId={customer.id} areas={customerAreas} />
            </CardContent>
          </Card>
          </TabSection>

          {/* Materials & Orders — POs + stock for this customer */}
          <TabSection tab="materials" overview={false}>
            <CustomerOrdersCard
              customerId={customer.id}
              pos={customerPOs}
              stockPulls={stockPulls}
              attributed={attributedPoLines}
            />
          </TabSection>

          {/* Invoices */}
          <TabSection tab="invoices" overview={false}>
          <Card id="invoices" className="scroll-mt-24">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Invoices</CardTitle>
              <form action={createInvoice} data-tour="create-invoice">
                <input type="hidden" name="customer_id" value={customer.id} />
                <SubmitButton size="sm" pendingText="Creating…" confirm="Invoice created">
                  <Receipt className="size-3.5" /> New invoice
                </SubmitButton>
              </form>
            </CardHeader>
            <CardContent>
              {invoiceRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <div className="space-y-2">
                  {invoiceRows.map((inv) => (
                    <InvoiceRow key={inv.id} inv={inv} customerId={customer.id} />
                  ))}
                </div>
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

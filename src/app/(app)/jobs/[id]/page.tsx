import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  MapPin,
  Calendar,
  CalendarClock,
  User,
  Trash2,
  Play,
  Check,
  Send,
  Megaphone,
  Ruler,
  FileText,
  Warehouse,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { JobStatusBadge } from "@/components/job-status-badge";
import { FlowPositionBadge } from "@/components/flow-position-badge";
import { listWorkflowStages } from "@/lib/data/workflow";
import {
  getJob,
  listAssignableUsers,
  listWarehouseUsers,
  listJobFiles,
  getJobApplications,
} from "@/lib/data/jobs";
import { getProfileNames } from "@/lib/data/customers";
import { getJobCostAnalysis } from "@/lib/data/finance";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { getJobOpenBalance } from "@/lib/data/invoices";
import { listJobLabor } from "@/lib/data/job-labor";
import { getJobMaterials } from "@/lib/data/job-materials";
import { getMeasurementDocuments, getJobPhotos } from "@/lib/data/documents";
import { getJobSatisfaction } from "@/lib/data/jobs";
import { setJobShowPrices, setJobCollectsBalance } from "./wo-actions";
import { JobMeasurementUpload } from "./measurement-upload";
import { requireProfile } from "@/lib/auth";
import { lineTotal } from "@/lib/estimate-calc";
import { formatDate, formatMoney, to12 } from "@/lib/format";
import { JobForm } from "../job-form";
import {
  setJobStatus,
  deleteJob,
  emailJobSchedule,
  postJobToBoard,
  unpostJobFromBoard,
  assignInstaller,
  setJobAddress,
  assignWarehousePerson,
  submitJobToWarehouse,
} from "../actions";
import { getJobCrew } from "@/lib/data/install-crews";
import { listServiceAddresses } from "@/lib/data/service-addresses";
import { formatServiceAddress } from "@/lib/types";
import { deleteJobFile } from "../file-actions";
import { JobLaborCard } from "./job-labor-card";
import { JobMaterialsCard } from "./job-materials-card";
import { getOrgSettings } from "@/lib/data/org";
import { PrintButton } from "@/components/print-button";
import { InstallationWorkOrderDoc } from "./installation-wo";
import { buildInstallScheduleProps } from "@/lib/data/install-schedule";
import { InstallSchedule } from "@/app/(app)/customers/[id]/install-schedule";
import { ScheduleInstallButton } from "./schedule-install-button";
import { PostToBoardButton } from "./post-to-board-button";
import { EditWantedDatesButton } from "./edit-wanted-dates-button";
import { buildJobScope, lineSpec, PAD_ROLL_SQYD } from "@/lib/job-scope";
import { getJobProgress } from "@/lib/job-progress";
import { JobStepPopup } from "@/components/job-step-popup";
import { JobTabs, JobTabPanel, type JobTab } from "./job-tabs";
import { JobDocuments } from "./job-documents";
import { listJobDocuments } from "@/lib/data/job-documents";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  return { title: job?.title ?? "Job" };
}

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const justCreated = (await searchParams).created === "1";
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";

  const job = await getJob(id);
  if (!job) notFound();
  const progress = getJobProgress(job);

  const org = await getOrgSettings();
  // Same flow position the customer dashboard shows — from the ONE shared source.
  const flowStages = await listWorkflowStages();
  const flowStage =
    (job.customer?.workflow_stage_id
      ? flowStages.find((s) => s.id === job.customer!.workflow_stage_id)
      : null) ?? null;
  const users = isStaff ? await listAssignableUsers() : [];
  const names = job.assigned_to ? await getProfileNames([job.assigned_to]) : {};
  const assignedName = job.assigned_to ? names[job.assigned_to] : null;

  const files = await listJobFiles(id);
  const photos = files.filter((f) => f.kind === "photo");
  const signatures = files.filter((f) => f.kind === "signature");

  const isAssignedToMe = job.assigned_to === profile.id;
  const applicants = isStaff ? await getJobApplications(id) : [];

  // Profit/cost analysis is owner & admin only.
  const costAnalysis =
    profile.role === "admin" ? await getJobCostAnalysis(id) : null;
  // Crew pay capture (real labor cost) — staff only.
  const jobLabor = isStaff ? await listJobLabor(id) : [];
  // Materials & sourcing (stock vs special-order) — staff only.
  const jobMaterials = isStaff ? await getJobMaterials(id) : null;
  // Measurement diagrams (uploaded sketch + saved carpet plan) — everyone on
  // the job, crew included, so installers can read them without digging.
  const measureDocs = job.customer_id
    ? await getMeasurementDocuments(job.customer_id)
    : [];

  // Scheduling & crew assignment now live on the customer file (their home);
  // the job page shows the booked schedule read-only and links back there.
  const canSchedule = isStaff || profile.role === "scheduler";
  const installWindowLabel = job.arrival_window
    ? job.arrival_window
        .split("-")
        .map((t) => to12(t))
        .join("–")
    : null;

  const serviceAddresses = isStaff
    ? await listServiceAddresses(job.customer_id)
    : [];
  const canAssignWarehouse = profile.role === "admin" || profile.role === "office";
  const warehouseUsers = canAssignWarehouse ? await listWarehouseUsers() : [];

  // Optional: the assigned installer can collect the balance on site. Per-job
  // override (null = inherit the global setting). The collection action itself
  // lives on the crew's My Work page — here we only show the balance read-only.
  const bizSettings = await getBusinessSettings();
  const collectsBalance =
    job.installer_collects_balance ?? bizSettings.installer_collects_balance;
  const jobCrew = isStaff ? await getJobCrew(job.id) : null;

  // Completion (photos, sign-off, balance) is captured by the crew on their My
  // Work page; the job page shows it read-only.
  // Prices are for staff only — installers never see estimate/job financials
  // (the COD balance to collect is handled separately).
  const showPrices = isStaff && !!job.show_prices;
  // Room-grouped scope — the same source the printed installation work order uses.
  const scope = buildJobScope(job.line_items, job.notes);
  const renderLine = (l: (typeof job.line_items)[number]) => {
    const spec = lineSpec(l);
    const tags = [l.manufacturer, l.style, l.color, l.item_no ? `#${l.item_no}` : null]
      .filter(Boolean)
      .join(" · ");
    return (
      <div key={l.id} className="flex items-start justify-between gap-4 py-2">
        <div>
          <div className="font-medium">
            {l.description || "Line item"}
            {tags ? (
              <span className="ml-1 text-xs font-normal text-muted-foreground">{tags}</span>
            ) : null}
            {l.from_stock ? (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                From stock
              </span>
            ) : null}
          </div>
          {spec.qty || spec.cut || spec.rolls ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {spec.qty ? <span className="font-medium text-foreground">{spec.qty}</span> : null}
              {spec.cut ? (
                <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                  ✂ Cut {spec.cut}
                </span>
              ) : null}
              {spec.rolls ? (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                  {spec.rolls} roll{spec.rolls > 1 ? "s" : ""} @ {PAD_ROLL_SQYD} sq yd
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {showPrices ? (
          <div className="shrink-0 text-muted-foreground">{formatMoney(lineTotal(l))}</div>
        ) : null}
      </div>
    );
  };
  const canInstallerTools = isStaff || isAssignedToMe;
  const jobPhotos = canInstallerTools ? await getJobPhotos(id) : [];
  const satisfaction = canInstallerTools ? await getJobSatisfaction(id) : null;
  const balanceInfo =
    collectsBalance && canInstallerTools ? await getJobOpenBalance(id) : null;
  // Balance for the printed installation work order (shown when the installer
  // collects on site) — reuse the one above, else fetch it.
  const woCollectBalance = collectsBalance
    ? (balanceInfo?.balance ?? (await getJobOpenBalance(id)).balance)
    : null;

  const siteParts = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ].filter(Boolean);

  // The job's whole document history for the Documents tab (+ estimate date /
  // estimator / job total for the at-a-glance band). Financial documents
  // (estimates, invoices, POs, job total, balance detail) are staff-only —
  // installers get the non-financial docs (work order, staging, completion,
  // measurements). The COD balance still surfaces when they collect.
  const jobDocsFull = canInstallerTools ? await listJobDocuments(job) : null;
  const docGroups = jobDocsFull
    ? isStaff
      ? jobDocsFull.groups
      : jobDocsFull.groups
          .filter((g) => !["estimates", "invoices", "pos"].includes(g.key))
          .map((g) =>
            g.key === "completion"
              ? {
                  ...g,
                  items: g.items.filter(
                    (d) => d.key !== "balance" || collectsBalance,
                  ),
                }
              : g,
          )
    : [];

  // Which compartments this viewer gets. Documents is the default (first) tab.
  const tabsToShow: JobTab[] = [
    ...(jobDocsFull ? (["documents"] as JobTab[]) : []),
    "work_order",
    ...(canInstallerTools ? (["completion"] as JobTab[]) : []),
    ...(isStaff ? (["warehouse", "money", "manage"] as JobTab[]) : []),
  ];

  // Smart install scheduler for this job — opened from the "Schedule install"
  // icon in the header (staff or the assigned installer).
  const installProps =
    canInstallerTools && job.customer_id
      ? await buildInstallScheduleProps(job.id, job.customer_id)
      : null;

  return (
    <>
      <InstallationWorkOrderDoc
        org={org}
        job={job}
        assignedName={assignedName}
        collectOnSite={woCollectBalance}
        expectedDays={installProps?.installEst?.days ?? null}
        showPrices={showPrices}
      />
      <JobStepPopup
        jobs={[{ ...progress, title: job.title, justCreated }]}
      />
      <div className="mx-auto max-w-4xl print:hidden">
      <Link
        href="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to jobs
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {job.title || "Job"}
            </h1>
            <JobStatusBadge status={job.status} />
            <FlowPositionBadge stage={flowStage} stages={flowStages} />
          </div>
          <p className="text-sm text-muted-foreground">
            {isStaff && job.customer ? (
              <Link
                href={`/customers/${job.customer_id}`}
                className="hover:underline"
              >
                {job.customer.full_name}
              </Link>
            ) : (
              job.customer?.full_name
            )}
          </p>
        </div>
        {/* Quick actions — the assigned installer or staff. On phones the two
            on-site actions go big and full-width; Print tucks to the side. */}
        {isStaff || isAssignedToMe ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {installProps ? (
              <div className="w-full sm:w-auto">
                <ScheduleInstallButton
                  scheduler={<InstallSchedule {...installProps} />}
                  scheduled={!!job.scheduled_date}
                />
              </div>
            ) : null}
            {job.status !== "in_progress" && job.status !== "completed" ? (
              <form action={setJobStatus} className="w-full sm:w-auto">
                <input type="hidden" name="id" value={job.id} />
                <input type="hidden" name="status" value="in_progress" />
                <Button type="submit" variant="outline" className="w-full sm:w-auto">
                  <Play className="size-4" /> Start job
                </Button>
              </form>
            ) : null}
            {job.status !== "completed" ? (
              <form action={setJobStatus} className="w-full sm:w-auto">
                <input type="hidden" name="id" value={job.id} />
                <input type="hidden" name="status" value="completed" />
                <Button type="submit" size="lg" className="w-full sm:w-auto">
                  <Check className="size-4" /> Mark complete
                </Button>
              </form>
            ) : null}
            <div className="w-full sm:w-auto">
              <PrintButton label="Print work order" size="default" />
            </div>
          </div>
        ) : null}
      </div>

      {/* At-a-glance band — the job's "411" in five seconds. */}
      <div className="mb-6 rounded-xl border bg-card p-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Estimate
            </div>
            <div className="mt-0.5 text-lg font-semibold">
              {jobDocsFull?.estimateDate ? formatDate(jobDocsFull.estimateDate) : "—"}
            </div>
            <div className="text-sm text-muted-foreground">
              {jobDocsFull?.estimatorName ? `by ${jobDocsFull.estimatorName}` : "No estimate linked"}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Installation
            </div>
            <div className="mt-0.5 text-lg font-semibold">
              {job.scheduled_date
                ? `${formatDate(job.scheduled_date)}${job.scheduled_end && job.scheduled_end !== job.scheduled_date ? ` – ${formatDate(job.scheduled_end)}` : ""}`
                : "Not scheduled"}
            </div>
            <div className="text-sm text-muted-foreground">
              {installWindowLabel ? `arrives ${installWindowLabel} · ` : ""}
              {assignedName ? `by ${assignedName}` : "no installer"}
            </div>
            {canSchedule ? (
              <Link
                href={`/customers/${job.customer_id}#jobs`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CalendarClock className="size-3" />
                {job.scheduled_date ? "Reschedule" : "Schedule"}
              </Link>
            ) : null}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Customer &amp; site
            </div>
            <div className="mt-0.5 truncate text-lg font-semibold">
              {job.customer?.full_name ?? "—"}
            </div>
            <div className="flex items-start gap-1 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <span>{siteParts.length ? siteParts.join(" · ") : "No site address"}</span>
            </div>
          </div>
          {isStaff ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Job total / balance
              </div>
              <div className="mt-0.5 text-lg font-semibold">
                {jobDocsFull?.jobTotal != null ? formatMoney(jobDocsFull.jobTotal) : "—"}
              </div>
              <div className="text-sm text-muted-foreground">
                {jobDocsFull?.hasInvoice
                  ? (jobDocsFull.balance ?? 0) <= 0.005
                    ? "Paid in full"
                    : `${formatMoney(jobDocsFull.balance ?? 0)} due`
                  : "No invoice yet"}
              </div>
            </div>
          ) : collectsBalance && woCollectBalance && woCollectBalance > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Collect on site
              </div>
              <div className="mt-0.5 text-lg font-semibold">{formatMoney(woCollectBalance)}</div>
              <div className="text-sm text-muted-foreground">balance due</div>
            </div>
          ) : null}
        </div>
      </div>

      {/* After the work order exists: choose how to get it installed. */}
      {canSchedule &&
      !job.scheduled_date &&
      job.status !== "completed" &&
      job.status !== "cancelled" ? (
        <Card className="mb-6 border-primary/40 bg-primary/[0.04]">
          <CardContent className="py-4">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock className="size-5 shrink-0 text-primary" />
              <div>
                <div className="font-semibold">Get it installed</div>
                <div className="text-xs text-muted-foreground">
                  Book a crew now, or post it to the job board for installers to claim.
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {installProps ? (
                <ScheduleInstallButton
                  scheduler={<InstallSchedule {...installProps} />}
                  scheduled={false}
                />
              ) : null}
              {job.open_for_claim ? (
                <form action={unpostJobFromBoard}>
                  <input type="hidden" name="id" value={job.id} />
                  <Button type="submit" variant="outline">
                    <Megaphone className="size-4" /> Remove from job board
                  </Button>
                </form>
              ) : (
                <PostToBoardButton
                  jobId={job.id}
                  defaultDays={installProps?.installEst?.days ?? null}
                  installers={users
                    .filter((u) => u.role === "crew")
                    .map((u) => ({ id: u.id, name: u.name }))}
                />
              )}
              <Link href="/board" className="text-sm text-primary hover:underline">
                View board →
              </Link>
            </div>
            {job.open_for_claim ? (
              <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                ✓ On the job board — installers can claim it.
                {job.board_wanted_start || job.board_expected_days ? (
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {job.board_wanted_start
                      ? `wanted ${formatDate(job.board_wanted_start)}${job.board_wanted_end ? `–${formatDate(job.board_wanted_end)}` : ""}`
                      : ""}
                    {job.board_expected_days
                      ? `${job.board_wanted_start ? " · " : ""}~${job.board_expected_days} day${job.board_expected_days === 1 ? "" : "s"}`
                      : ""}
                  </span>
                ) : null}
              </p>
            ) : null}
            {job.open_for_claim || job.assigned_to ? (
              <div className="mt-2">
                <EditWantedDatesButton
                  jobId={job.id}
                  wantedStart={job.board_wanted_start}
                  wantedEnd={job.board_wanted_end}
                  expectedDays={job.board_expected_days}
                  assigned={!!job.assigned_to}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <JobTabs show={tabsToShow}>

      {jobDocsFull ? (
        <JobTabPanel tab="documents">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
            </CardHeader>
            <CardContent>
              <JobDocuments groups={docGroups} />
            </CardContent>
          </Card>
        </JobTabPanel>
      ) : null}

      <JobTabPanel tab="warehouse">
      {isStaff && job.scheduled_date ? (
        <form action={emailJobSchedule} className="mb-6">
          <input type="hidden" name="id" value={job.id} />
          <Button type="submit" variant="outline" size="sm">
            <Send className="size-3.5" /> Email schedule to customer
          </Button>
        </form>
      ) : null}

      </JobTabPanel>

      <JobTabPanel tab="work_order">
      {/* Work order scope */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Work order — scope</CardTitle>
        </CardHeader>
        <CardContent>
          {!scope.rooms.length &&
          !scope.wholeJob.products.length &&
          !scope.wholeJob.labor.length ? (
            <p className="text-sm text-muted-foreground">
              No scope attached. Link this job to an approved estimate to pull in
              the rooms and materials.
            </p>
          ) : (
            <div className="space-y-5">
              {scope.conditions.length ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    Conditions &amp; prep — all areas
                  </div>
                  <ul className="list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-200">
                    {scope.conditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {scope.rooms.map((room) => (
                <div key={room.name} className="rounded-lg border p-3">
                  <div className="flex items-baseline justify-between gap-2 border-b pb-1">
                    <div className="font-semibold">{room.name}</div>
                    {room.sqft ? (
                      <div className="text-xs tabular-nums text-muted-foreground">
                        {Math.round(room.sqft)} sq ft
                      </div>
                    ) : null}
                  </div>
                  {room.prep.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {room.prep.map((p, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {room.products.length ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Product going in
                      </div>
                      <div className="divide-y text-sm">{room.products.map(renderLine)}</div>
                    </div>
                  ) : null}
                  {room.labor.length ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Prep &amp; labor
                      </div>
                      <div className="divide-y text-sm">{room.labor.map(renderLine)}</div>
                    </div>
                  ) : null}
                </div>
              ))}

              {scope.wholeJob.products.length || scope.wholeJob.labor.length ? (
                <div className="rounded-lg border p-3">
                  <div className="border-b pb-1 font-semibold">Whole job</div>
                  {scope.wholeJob.products.length ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Materials
                      </div>
                      <div className="divide-y text-sm">
                        {scope.wholeJob.products.map(renderLine)}
                      </div>
                    </div>
                  ) : null}
                  {scope.wholeJob.labor.length ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Labor &amp; prep
                      </div>
                      <div className="divide-y text-sm">
                        {scope.wholeJob.labor.map(renderLine)}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {scope.freeText ? (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <div className="mb-1 font-medium">Special instructions</div>
                  <p className="whitespace-pre-wrap text-muted-foreground">{scope.freeText}</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Staff work-order settings: prices + who collects the balance */}
          {isStaff ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 text-sm">
              <form action={setJobShowPrices} className="flex items-center gap-2">
                <input type="hidden" name="job_id" value={job.id} />
                <input type="hidden" name="show" value={showPrices ? "0" : "1"} />
                <span className="text-muted-foreground">Prices on work order:</span>
                <button type="submit" className={`rounded-full px-2.5 py-1 text-xs font-medium ${showPrices ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {showPrices ? "Shown" : "Hidden"}
                </button>
              </form>
              <form action={setJobCollectsBalance} className="flex items-center gap-2">
                <input type="hidden" name="job_id" value={job.id} />
                <span className="text-muted-foreground">Installer collects balance:</span>
                <select
                  name="value"
                  defaultValue={job.installer_collects_balance == null ? "" : job.installer_collects_balance ? "yes" : "no"}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  <option value="">Default ({bizSettings.installer_collects_balance ? "yes" : "no"})</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
                <button type="submit" className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted">Set</button>
              </form>
            </div>
          ) : null}
        </CardContent>
      </Card>

      </JobTabPanel>

      <JobTabPanel tab="completion">
      {/* Job completion — read-only. The crew captures the sign-off, photos and
          any on-site payment on their My Work page; this is the office's view. */}
      {canInstallerTools ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Job completion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            {/* Customer sign-off */}
            <div>
              <div className="mb-1.5 flex items-center gap-2 font-medium">
                Customer sign-off
                {satisfaction || signatures.length ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    Signed ✓
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Pending
                  </span>
                )}
              </div>
              {satisfaction ? (
                <div className="space-y-1.5">
                  {satisfaction.rating ? (
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={cn(
                            "size-4",
                            n <= (satisfaction.rating ?? 0)
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted",
                          )}
                        />
                      ))}
                    </div>
                  ) : null}
                  {satisfaction.comments ? (
                    <p className="text-muted-foreground">“{satisfaction.comments}”</p>
                  ) : null}
                  {satisfaction.signature ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={satisfaction.signature}
                      alt="Customer signature"
                      className="h-20 rounded border bg-white"
                    />
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {satisfaction.signed_name ? `${satisfaction.signed_name} · ` : ""}
                    {new Date(satisfaction.signed_at).toLocaleString()}
                  </p>
                </div>
              ) : signatures.length ? (
                <div className="space-y-2">
                  {signatures.map((s) => (
                    <div key={s.id} className="rounded-md border p-2">
                      {s.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.url} alt="Signature" className="h-20 bg-white" />
                      ) : null}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {s.signer_name ? `Signed by ${s.signer_name} · ` : ""}
                        {formatDate(s.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Not signed yet — the crew captures this on their{" "}
                  <span className="font-medium">My Work</span> page.
                </p>
              )}
            </div>

            {/* On-site balance (read-only) */}
            {balanceInfo ? (
              <div className="border-t pt-3">
                <div className="mb-1 font-medium">Balance</div>
                {!balanceInfo.hasInvoice ? (
                  <p className="text-muted-foreground">No invoice yet.</p>
                ) : balanceInfo.balance <= 0 ? (
                  <p className="text-emerald-700 dark:text-emerald-400">Paid in full.</p>
                ) : (
                  <p>
                    <span className="font-semibold">{formatMoney(balanceInfo.balance)}</span>{" "}
                    <span className="text-muted-foreground">
                      due — the installer can collect on site (My Work).
                    </span>
                  </p>
                )}
              </div>
            ) : null}

            {/* Completed photos (new completion uploads + legacy job files) */}
            <div className="border-t pt-3">
              <div className="mb-1.5 font-medium">
                Completed photos
                {jobPhotos.length + photos.length
                  ? ` (${jobPhotos.length + photos.length})`
                  : ""}
              </div>
              {jobPhotos.length + photos.length === 0 ? (
                <p className="text-muted-foreground">No completed photos yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {jobPhotos.map((p) =>
                    p.url ? (
                      <a
                        key={p.id}
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" />
                      </a>
                    ) : null,
                  )}
                  {photos.map((f) =>
                    f.url ? (
                      <div key={f.id} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={f.url}
                          alt={f.caption ?? "Job photo"}
                          className="aspect-square w-full rounded-lg border object-cover"
                        />
                        {isStaff ? (
                          <form action={deleteJobFile} className="absolute right-1 top-1">
                            <input type="hidden" name="id" value={f.id} />
                            <input type="hidden" name="job_id" value={job.id} />
                            <input type="hidden" name="path" value={f.path} />
                            <Button
                              type="submit"
                              variant="destructive"
                              size="icon-xs"
                              aria-label="Delete photo"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      </JobTabPanel>

      <JobTabPanel tab="work_order">
      {/* Measurements & diagrams — big & clear for the installers */}
      {job.customer_id ? (
        <Card className="mb-6 border-primary/30">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Ruler className="size-4 text-primary" /> Measurements &amp; diagrams
            </CardTitle>
            <JobMeasurementUpload jobId={job.id} />
          </CardHeader>
          <CardContent>
            {measureDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No measurement diagram yet. Snap a photo of the field measurements
                or attach the salesperson&apos;s drawing so the crew can see it.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  {measureDocs.map((d) => {
                    const img = (d.mime ?? "").startsWith("image/");
                    return (
                      <a
                        key={d.id}
                        href={d.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border transition-colors hover:border-primary"
                      >
                        {img && d.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={d.url}
                            alt={d.name}
                            className="max-h-[28rem] w-full bg-muted object-contain"
                          />
                        ) : (
                          <div className="flex items-center gap-2 p-6 text-sm">
                            <FileText className="size-6 text-muted-foreground" />
                            Open {d.name}
                          </div>
                        )}
                        <div className="border-t px-3 py-2 text-xs font-medium">
                          {d.name}
                        </div>
                      </a>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Tap a diagram to open it full-size.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      </JobTabPanel>

      <JobTabPanel tab="warehouse">
      {/* Site address — for accounts with multiple properties */}
      {isStaff && serviceAddresses.length > 0 ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Site address</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm">
              {siteParts.length ? siteParts.join(" · ") : "No site address set."}
            </p>
            <form action={setJobAddress} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="job_id" value={job.id} />
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Which property?
                </label>
                <select
                  name="service_address_id"
                  defaultValue={job.service_address_id ?? ""}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Primary address</option>
                  {serviceAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label || formatServiceAddress(a)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline">
                Update site
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Cash-and-carry / pickup: send to the warehouse to cut & stage (no
          install date, so it doesn't auto-submit) */}
      {isStaff &&
      (job.delivery_type === "cash_carry" ||
        job.delivery_type === "installer_pickup") &&
      !job.warehouse_submitted_at ? (
        <Card className="mb-6 border-amber-300 dark:border-amber-900/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="text-sm">
              <div className="font-medium">Cash &amp; carry / pickup</div>
              <div className="text-muted-foreground">
                Send this to the warehouse to be cut &amp; staged for pickup.
              </div>
            </div>
            <form action={submitJobToWarehouse}>
              <input type="hidden" name="job_id" value={job.id} />
              <Button type="submit" size="sm">
                Send to warehouse
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Warehouse — who preps/stages this job (office/admin) */}
      {canAssignWarehouse ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Warehouse prep</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {job.warehouse_ready_at
                ? `Staged & ready${job.staging_location ? ` at ${job.staging_location}` : ""}.`
                : job.warehouse_accepted_at
                  ? "Accepted — being staged."
                  : job.warehouse_submitted_at
                    ? "Submitted to the warehouse — awaiting acceptance."
                    : "Not sent yet. Sends automatically once the install is scheduled, or start prep now."}
            </p>
            {!job.warehouse_submitted_at ? (
              <form action={submitJobToWarehouse}>
                <input type="hidden" name="id" value={job.id} />
                <Button type="submit" size="sm">
                  <Warehouse className="size-4" /> Send to warehouse now
                </Button>
              </form>
            ) : null}
            {warehouseUsers.length > 0 ? (
              <form action={assignWarehousePerson} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="job_id" value={job.id} />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Assigned warehouse person
                  </label>
                  <select
                    name="warehouse_person_id"
                    defaultValue={job.warehouse_assigned_to ?? ""}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">— Anyone —</option>
                    {warehouseUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" size="sm" variant="outline">
                  {job.warehouse_assigned_to ? "Reassign" : "Assign"}
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                No warehouse logins yet — add one under Settings → Team.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Materials & sourcing (stock vs special-order) — staff only */}
      {jobMaterials ? <JobMaterialsCard data={jobMaterials} /> : null}

      </JobTabPanel>

      <JobTabPanel tab="money">
      {/* Crew pay (real subcontractor labor cost) — staff only */}
      {isStaff ? <JobLaborCard jobId={id} rows={jobLabor} crew={jobCrew} /> : null}

      {/* Profitability — estimated vs actual (owner/admin only) */}
      {costAnalysis ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              Profitability — estimated vs actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!costAnalysis.hasEstimateCosts ? (
              <p className="text-sm text-muted-foreground">
                No costs were entered on the estimate, so there&apos;s nothing to
                compare yet. Add material/labor costs in the wizard to track
                margin here.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-0 text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Metric</th>
                    <th className="px-3 py-2 text-right">Estimated</th>
                    <th className="px-3 py-2 text-right">Actual</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-3 py-2">Material cost</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estMaterial)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualMaterial)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(
                        costAnalysis.actualMaterial - costAnalysis.estMaterial,
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Labor / other cost</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estLabor)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualExpense)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(
                        costAnalysis.actualExpense - costAnalysis.estLabor,
                      )}
                    </td>
                  </tr>
                  <tr className="font-medium">
                    <td className="px-3 py-2">Total cost</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estCost)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualCost)}
                    </td>
                    <td
                      className={
                        costAnalysis.costVariance > 0
                          ? "px-3 py-2 text-right text-destructive"
                          : "px-3 py-2 text-right text-emerald-600"
                      }
                    >
                      {costAnalysis.costVariance > 0 ? "+" : ""}
                      {formatMoney(costAnalysis.costVariance)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Profit (at sold price)</td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.estProfit)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(costAnalysis.actualProfit)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMoney(
                        costAnalysis.actualProfit - costAnalysis.estProfit,
                      )}
                    </td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-3 py-2">Margin</td>
                    <td className="px-3 py-2 text-right">
                      {costAnalysis.estMargin.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      {costAnalysis.actualMargin.toFixed(1)}%
                    </td>
                    <td
                      className={
                        costAnalysis.marginDelta < 0
                          ? "px-3 py-2 text-right text-destructive"
                          : "px-3 py-2 text-right text-emerald-600"
                      }
                    >
                      {costAnalysis.marginDelta >= 0 ? "+" : ""}
                      {costAnalysis.marginDelta.toFixed(1)} pts
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Actual material = purchase orders on this estimate. Actual
              labor/other = expenses logged to this job. Revenue held at the sold
              price to show whether the job hit its target margin.
            </p>
          </CardContent>
        </Card>
      ) : null}

      </JobTabPanel>

      <JobTabPanel tab="manage">
      {/* Staff editing */}
      {isStaff ? (
        <>
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Job board</CardTitle>
              {job.open_for_claim ? (
                <form action={unpostJobFromBoard}>
                  <input type="hidden" name="id" value={job.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Remove from board
                  </Button>
                </form>
              ) : (
                <form action={postJobToBoard}>
                  <input type="hidden" name="id" value={job.id} />
                  <Button type="submit" size="sm">
                    <Megaphone className="size-3.5" /> Post to board
                  </Button>
                </form>
              )}
            </CardHeader>
            <CardContent>
              {applicants.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {job.open_for_claim
                    ? "Posted — waiting for installers to apply."
                    : "Post this job so installers can claim it."}
                </p>
              ) : (
                <ul className="divide-y text-sm">
                  {applicants.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="font-medium">{a.installer_name}</span>
                      {job.assigned_to === a.installer_id ? (
                        <span className="text-xs font-medium text-green-600">
                          Assigned ✓
                        </span>
                      ) : (
                        <form action={assignInstaller}>
                          <input type="hidden" name="job_id" value={job.id} />
                          <input
                            type="hidden"
                            name="installer_id"
                            value={a.installer_id}
                          />
                          <Button type="submit" size="sm">
                            Assign
                          </Button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Schedule &amp; details</CardTitle>
            </CardHeader>
            <CardContent>
              <JobForm job={job} users={users} />
            </CardContent>
          </Card>

          <div className="mt-4 flex items-center justify-between">
            {job.estimate_id ? (
              <Link
                href={`/estimates/${job.estimate_id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View source estimate
              </Link>
            ) : (
              <span />
            )}
            <form action={deleteJob}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="customer_id" value={job.customer_id} />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-3.5" /> Delete job
              </Button>
            </form>
          </div>
        </>
      ) : null}
      </JobTabPanel>

      </JobTabs>
    </div>
    </>
  );
}

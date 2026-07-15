import Link from "next/link";
import {
  Phone,
  CalendarClock,
  FileText,
  DollarSign,
  Boxes,
  Hammer,
  Receipt,
  CheckCircle2,
  ClipboardCheck,
  ArrowRight,
  Check,
  PauseCircle,
  XCircle,
  Ruler,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  Customer,
  WorkflowStage,
  Estimate,
  Job,
  Invoice,
} from "@/lib/types";
import { invoiceTotals } from "@/lib/invoice-calc";
import { amountPaid } from "@/lib/data/invoices";
import { getJobMaterials } from "@/lib/data/job-materials";
import type { JobSatisfaction } from "@/lib/data/jobs";
import { advanceWorkflow } from "../actions";
import { EstimateScheduler } from "./estimate-scheduler";
import { InstallSchedule, type InstallScheduleProps } from "./install-schedule";
import { StageSpine } from "./stage-spine";
import {
  stepGate,
  resolveFlowStep,
  nextMainlineStage,
  isLostStage,
  isParkStage,
  isOffSpine,
  STEP_TITLES,
  type FlowFacts,
  type FlowStep,
} from "@/lib/job-flow";
import { OwnerOverride } from "./owner-override";
import { JobMaterialsCard } from "@/app/(app)/jobs/[id]/job-materials-card";
import { SatisfactionForm } from "@/app/(app)/jobs/[id]/satisfaction-form";
import { setEstimateStatus } from "@/app/(app)/estimates/actions";
import { createPOFromEstimate } from "@/app/(app)/purchase-orders/actions";
import { createJobFromEstimate } from "@/app/(app)/jobs/actions";

// Step vocabulary, step resolution, off-spine detection, and next-stage all come
// from the ONE shared source (@/lib/job-flow) so every page agrees.
type Step = FlowStep;

const STEP_ICON: Record<Step, typeof Phone> = {
  contact: Phone,
  schedule_estimate: CalendarClock,
  estimate_booked: Ruler,
  build_quote: FileText,
  approve: ClipboardCheck,
  collect_deposit: DollarSign,
  materials: Boxes,
  schedule_install: Hammer,
  waiting: PauseCircle,
  await_install: CalendarClock,
  followup: Receipt,
  complete: CheckCircle2,
  generic: ArrowRight,
};
const STEP_META: Record<Step, { icon: typeof Phone; title: string }> = Object.fromEntries(
  (Object.keys(STEP_ICON) as Step[]).map((k) => [k, { icon: STEP_ICON[k], title: STEP_TITLES[k] }]),
) as Record<Step, { icon: typeof Phone; title: string }>;

/** Bold "ready for next stage" gate — the only way a job advances (manual). */
function AdvanceButton({
  customerId,
  ownerId,
  nextStage,
  label,
  size = "lg",
  disabled = false,
}: {
  customerId: string;
  ownerId: string | null;
  nextStage: WorkflowStage | null;
  label?: string;
  size?: "sm" | "lg";
  disabled?: boolean;
}) {
  if (!nextStage) return null;
  return (
    <form action={advanceWorkflow}>
      <input type="hidden" name="id" value={customerId} />
      <input type="hidden" name="to_stage" value={nextStage.id} />
      <input type="hidden" name="to_user" value={ownerId ?? ""} />
      <SubmitButton
        size={size}
        disabled={disabled}
        pendingText="Advancing…"
        confirm="Moved to the next stage"
      >
        <Check className="size-4" /> {label ?? "Ready for next stage"}
        <span className="opacity-80">· {nextStage.name}</span>
      </SubmitButton>
    </form>
  );
}

export async function GuidedFlow({
  customer,
  stages,
  currentStage,
  estimates,
  jobs,
  invoices,
  repOptions,
  installScheduleProps,
  jobSatisfaction,
  hasActivity,
  estimateBooked,
  isOwner,
}: {
  customer: Customer;
  stages: WorkflowStage[];
  currentStage: WorkflowStage | null;
  estimates: Estimate[];
  jobs: Job[];
  invoices: Invoice[];
  repOptions: { id: string; name: string }[];
  installScheduleProps: InstallScheduleProps | null;
  jobSatisfaction: JobSatisfaction | null;
  /** Real signals for the soft steps (contact/measure), passed from the file. */
  hasActivity: boolean;
  estimateBooked: boolean;
  /** Only the owner may override a blocked step. */
  isOwner: boolean;
}) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const mainline = sorted.filter((s) => !isOffSpine(s));
  const currentIsLost = currentStage ? isLostStage(currentStage) : false;
  const currentIsPark = currentStage ? isParkStage(currentStage) : false;
  const currentIdx = currentStage
    ? mainline.findIndex((s) => s.id === currentStage.id)
    : -1;
  const step = resolveFlowStep(currentStage, stages);
  const nextStage = nextMainlineStage(currentStage, stages);
  const owner = customer.workflow_owner_id ?? null;
  const Meta = STEP_META[step];

  const lostStage = sorted.find((s) => isLostStage(s)) ?? null;
  const waitingStage = sorted.find((s) => isParkStage(s)) ?? null;

  // Resuming from hold should land where the job actually is: on the install
  // stage if it's already booked, else back on the "schedule the install" step.
  const scheduleStage = sorted.find((s) => s.auto_action === "schedule_install") ?? null;
  // Must match "Install Scheduled" but NOT the earlier "Installation Needs
  // Scheduled" (both contain install+scheduled) — same exclusion as
  // STAGE_INSTALL_SCHEDULED in jobs/actions.ts, or resume-from-hold lands the
  // customer on the wrong stage.
  const installScheduledStage =
    sorted.find((s) => /^(?!.*\bneeds\b).*install.*sched/.test(s.name.toLowerCase())) ?? null;
  const hasScheduledJob = jobs.some(
    (j) => j.scheduled_date && j.status !== "cancelled" && j.status !== "completed",
  );
  const resumeStage =
    (hasScheduledJob ? installScheduledStage : scheduleStage) ?? nextStage;

  const activeEstimate =
    estimates.find((e) => e.status === "sent") ??
    estimates.find((e) => e.status === "draft") ??
    estimates.find((e) => e.status === "approved") ??
    estimates[0] ??
    null;
  const approvedEstimate = estimates.find((e) => e.status === "approved") ?? null;
  const activeJob =
    jobs.find((j) => j.status !== "completed" && j.status !== "cancelled") ??
    jobs[0] ??
    null;
  const openInvoices = invoices
    .filter((i) => i.status !== "void")
    .map((i) => ({
      inv: i,
      bal: invoiceTotals(i.items ?? [], i.tax_rate, amountPaid(i)).balance,
    }))
    .filter((x) => x.bal > 0.005);

  // The action-gate: read the REAL records to decide whether THIS step's action
  // is done. Strict — advancing is blocked (with a clear reason) until it is.
  const facts: FlowFacts = {
    hasActivity,
    estimateBooked,
    hasEstimate: estimates.length > 0,
    estimateSent: estimates.some((e) => e.status === "sent" || e.status === "approved"),
    estimateApproved: !!approvedEstimate,
    depositPaid: invoices.some((i) => amountPaid(i) > 0),
    workOrderExists: jobs.length > 0,
    materialsStaged: jobs.some((j) => !!j.warehouse_ready_at),
    installBooked: !!activeJob?.scheduled_date,
    installComplete: jobs.some((j) => j.status === "completed"),
    balancePaid: openInvoices.length === 0,
    satisfactionSigned: !!jobSatisfaction,
  };
  const gate = stepGate(step, facts);

  // ---- Per-stage inline body (the REAL tool, wired to real data) -----------
  let body: React.ReactNode = null;

  if (step === "contact" || step === "schedule_estimate") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {currentStage?.next_action ||
            "Log your first call in Activity, then book the in-home estimate or showroom visit."}
        </p>
        <EstimateScheduler
          customerId={customer.id}
          autoOpen={step === "schedule_estimate"}
          reps={repOptions}
          defaultRep={customer.assigned_to}
        />
      </div>
    );
  } else if (step === "estimate_booked") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {currentStage?.next_action ||
            "Go measure and meet the customer. When you're back with numbers, advance to build the estimate."}
        </p>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Reschedule the estimate
          </summary>
          <div className="mt-2">
            <EstimateScheduler
              customerId={customer.id}
              reps={repOptions}
              defaultRep={customer.assigned_to}
            />
          </div>
        </details>
      </div>
    );
  } else if (step === "build_quote") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Price this job and send the estimate. Advance when it&apos;s out to the customer.
        </p>
        <div className="flex flex-wrap gap-2">
          {activeEstimate ? (
            <Link
              href={`/estimates/${activeEstimate.id}/edit`}
              className={buttonVariants({ size: "sm" })}
            >
              Open estimate builder
            </Link>
          ) : null}
          <Link
            href={`/estimates/smart?customer=${customer.id}`}
            className={buttonVariants({
              size: "sm",
              variant: activeEstimate ? "outline" : "default",
            })}
          >
            <FileText className="size-3.5" /> Build estimate
          </Link>
        </div>
      </div>
    );
  } else if (step === "approve") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Follow up to get the estimate approved. You can mark it approved here once the
          customer says yes.
        </p>
        {activeEstimate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/estimates/${activeEstimate.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              Open estimate
            </Link>
            {activeEstimate.status !== "approved" ? (
              <form action={setEstimateStatus}>
                <input type="hidden" name="id" value={activeEstimate.id} />
                <input type="hidden" name="status" value="approved" />
                <SubmitButton size="sm" pendingText="Approving…" confirm="Estimate approved">
                  <Check className="size-4" /> Mark approved
                </SubmitButton>
              </form>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
                <CheckCircle2 className="size-4" /> Approved
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No estimate yet — build and send one first.
          </p>
        )}
      </div>
    );
  } else if (step === "collect_deposit") {
    const depositInvoice = invoices.find((i) => i.status !== "void");
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Create the deposit invoice and record the payment.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {depositInvoice ? (
            <Link
              href={`/invoices/${depositInvoice.id}`}
              className={buttonVariants({ size: "sm" })}
            >
              Open invoice & record payment
            </Link>
          ) : approvedEstimate ? (
            <Link
              href={`/estimates/${approvedEstimate.id}/invoice`}
              className={buttonVariants({ size: "sm" })}
            >
              Create deposit invoice
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">
              Approve the estimate first.
            </span>
          )}
        </div>
      </div>
    );
  } else if (step === "materials") {
    const mats = activeJob ? await getJobMaterials(activeJob.id) : null;
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Order materials and get the job ready to stage.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {!activeJob && approvedEstimate ? (
            <form action={createJobFromEstimate}>
              <input type="hidden" name="estimate_id" value={approvedEstimate.id} />
              <SubmitButton size="sm" pendingText="Creating…" confirm="Job created">
                <Hammer className="size-3.5" /> Create job
              </SubmitButton>
            </form>
          ) : null}
          {approvedEstimate ? (
            <form action={createPOFromEstimate}>
              <input type="hidden" name="estimate_id" value={approvedEstimate.id} />
              <SubmitButton size="sm" variant="outline" pendingText="Creating…" confirm="PO created">
                <Boxes className="size-3.5" /> Create purchase order
              </SubmitButton>
            </form>
          ) : null}
          <Link
            href="/purchase-orders"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Purchase orders
          </Link>
        </div>
        {mats ? <JobMaterialsCard data={mats} /> : null}
      </div>
    );
  } else if (step === "schedule_install") {
    body = installScheduleProps ? (
      <InstallSchedule {...installScheduleProps} />
    ) : (
      <p className="text-sm text-muted-foreground">
        Create the job from the approved estimate first (Jobs panel below),
        then install times suggest here.
      </p>
    );
  } else if (step === "waiting") {
    body = (
      <p className="text-sm text-muted-foreground">
        {currentStage?.next_action ||
          "Parked here until the customer is ready. Advance when they give the go-ahead."}
      </p>
    );
  } else if (step === "await_install") {
    body = (
      <div className="space-y-3">
        {activeJob?.scheduled_date ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
              <CalendarClock className="size-4" /> Install booked
            </div>
            <div className="mt-1 font-medium">
              {formatDate(activeJob.scheduled_date)}
              {activeJob.arrival_window ? ` · ${activeJob.arrival_window}` : ""}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Install stage — book the date in the scheduler if it isn&apos;t set yet.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {activeJob ? (
            <Link
              href={`/jobs/${activeJob.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              Open work order
            </Link>
          ) : null}
        </div>
      </div>
    );
  } else if (step === "followup") {
    body = (
      <div className="space-y-4">
        {activeJob ? (
          <SatisfactionForm jobId={activeJob.id} existing={jobSatisfaction} />
        ) : null}
        <div className="space-y-2">
          <p className="text-sm font-medium">Balance</p>
          {openInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing outstanding — paid in full.</p>
          ) : (
            openInvoices.map(({ inv, bal }) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <span>
                  {inv.number || "Invoice"} —{" "}
                  <span className="font-medium">{formatMoney(bal)} due</span>
                </span>
                <Link href={`/invoices/${inv.id}`} className={buttonVariants({ size: "sm" })}>
                  Record payment
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    );
  } else if (step === "complete") {
    body = (
      <p className="text-sm text-muted-foreground">
        🎉 This job is complete — every stage done. Nice work.
      </p>
    );
  } else {
    body = (
      <p className="text-sm text-muted-foreground">
        {currentStage?.next_action || "Advance this job to the next stage when ready."}
      </p>
    );
  }

  return (
    <div className="mb-6 space-y-3">
      {/* Stage spine: been → here → ahead */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-foreground">
            {currentStage
              ? currentIsLost
                ? currentStage.name
                : currentIsPark
                  ? `On hold · ${currentStage.name}`
                  : `Stage ${currentIdx + 1} of ${mainline.length} · ${currentStage.name}`
              : "Not started"}
          </span>
          {nextStage && !currentIsLost && !currentIsPark ? (
            <span className="text-muted-foreground">Next: {nextStage.name}</span>
          ) : null}
        </div>
        <StageSpine
          stages={mainline.map((s, i) => ({
            name: s.name,
            state:
              currentIdx >= 0 && i < currentIdx
                ? "done"
                : currentIdx === i
                  ? "active"
                  : "upcoming",
          }))}
        />
      </div>

      {/* The current stage — its real tool + the "ready for next" gate */}
      <Card className="overflow-hidden rounded-lg border-primary/40 bg-gradient-to-b from-primary/[0.06] to-card shadow-sm ring-1 ring-primary/15">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Meta.icon className="size-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                {currentIsLost ? "This deal" : currentIsPark ? "On hold" : "Current stage"}
              </p>
              <p className="text-lg font-bold tracking-tight">{Meta.title}</p>
            </div>
          </div>

          {body}

          {/* On hold — a one-tap resume back to where the job actually is. */}
          {currentIsPark ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              {resumeStage ? (
                <form action={advanceWorkflow}>
                  <input type="hidden" name="id" value={customer.id} />
                  <input type="hidden" name="to_stage" value={resumeStage.id} />
                  <input type="hidden" name="to_user" value={owner ?? ""} />
                  <SubmitButton size="lg" pendingText="Resuming…" confirm="Back in play">
                    <Check className="size-4" /> Resume
                    <span className="opacity-80">· {resumeStage.name}</span>
                  </SubmitButton>
                </form>
              ) : null}
              {lostStage ? (
                <form action={advanceWorkflow}>
                  <input type="hidden" name="id" value={customer.id} />
                  <input type="hidden" name="to_stage" value={lostStage.id} />
                  <input type="hidden" name="to_user" value={owner ?? ""} />
                  <SubmitButton size="sm" variant="outline" pendingText="Saving…" confirm="Marked lost">
                    <XCircle className="size-3.5" /> Mark lost / declined
                  </SubmitButton>
                </form>
              ) : null}
            </div>
          ) : null}

          {/* Action-gated advance — strict: the step's action must be done first,
              and it says exactly what's still needed if not. */}
          {!currentIsLost && !currentIsPark && step !== "complete" ? (
            <div className="space-y-3 border-t pt-4">
              {gate.done ? (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" /> Step done
                  </span>
                  <AdvanceButton
                    customerId={customer.id}
                    ownerId={owner}
                    nextStage={nextStage}
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="size-4" /> Finish this step to advance
                  </div>
                  <p className="mt-0.5 text-sm text-amber-900 dark:text-amber-200">{gate.reason}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <AdvanceButton
                      customerId={customer.id}
                      ownerId={owner}
                      nextStage={nextStage}
                      size="sm"
                      disabled
                    />
                    {isOwner && nextStage ? (
                      <OwnerOverride
                        customerId={customer.id}
                        toStageId={nextStage.id}
                        toUser={owner}
                        stepLabel={Meta.title}
                        blockedReason={gate.reason ?? ""}
                      />
                    ) : null}
                  </div>
                </div>
              )}

              <details className="text-sm">
                <summary className="cursor-pointer list-none text-muted-foreground hover:text-foreground">
                  Not yet?
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {waitingStage && waitingStage.id !== currentStage?.id ? (
                    <form action={advanceWorkflow}>
                      <input type="hidden" name="id" value={customer.id} />
                      <input type="hidden" name="to_stage" value={waitingStage.id} />
                      <input type="hidden" name="to_user" value={owner ?? ""} />
                      <SubmitButton size="sm" variant="outline" pendingText="Saving…" confirm="Put on hold">
                        <PauseCircle className="size-3.5" /> Put on hold
                      </SubmitButton>
                    </form>
                  ) : null}
                  {lostStage ? (
                    <form action={advanceWorkflow}>
                      <input type="hidden" name="id" value={customer.id} />
                      <input type="hidden" name="to_stage" value={lostStage.id} />
                      <input type="hidden" name="to_user" value={owner ?? ""} />
                      <SubmitButton size="sm" variant="outline" pendingText="Saving…" confirm="Marked lost">
                        <XCircle className="size-3.5" /> Mark lost / declined
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}

          {currentIsLost ? (
            <div className="border-t pt-4">
              <form action={advanceWorkflow}>
                <input type="hidden" name="id" value={customer.id} />
                <input type="hidden" name="to_stage" value={mainline[0]?.id ?? ""} />
                <input type="hidden" name="to_user" value={owner ?? ""} />
                <SubmitButton size="sm" variant="outline" pendingText="Reopening…" confirm="Reopened">
                  Reopen this job
                </SubmitButton>
              </form>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

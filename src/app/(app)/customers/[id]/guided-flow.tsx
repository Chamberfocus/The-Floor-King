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
  ChevronRight,
  PauseCircle,
  XCircle,
  Ruler,
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
import { JobMaterialsCard } from "@/app/(app)/jobs/[id]/job-materials-card";
import { SatisfactionForm } from "@/app/(app)/jobs/[id]/satisfaction-form";
import { setEstimateStatus } from "@/app/(app)/estimates/actions";
import { createPOFromEstimate } from "@/app/(app)/purchase-orders/actions";
import { createJobFromEstimate } from "@/app/(app)/jobs/actions";

/** Off-ramp stages (dead deals) live outside the linear spine. */
const isLostStage = (s: { name: string }) =>
  /lost|declin|dead|cancel/.test(s.name.toLowerCase());

/** The "on hold / waiting on the customer" park stage — reachable ANY time via
 *  "Put on hold", but NOT a numbered step in the pipeline. Word-boundary matched
 *  so mainline "Awaiting …" stages (a-WAITing — an approval / measuring step) are
 *  never mistaken for the park stage. */
const isParkStage = (s: { name: string }) =>
  /\bwaiting\b|\bon hold\b|\bhold\b|\bpark/.test(s.name.toLowerCase());

/** Stages that sit OUTSIDE the linear spine (dead deals + the on-hold park). */
const isOffSpine = (s: { name: string }) => isLostStage(s) || isParkStage(s);

type Step =
  | "contact"
  | "schedule_estimate"
  | "estimate_booked"
  | "build_quote"
  | "approve"
  | "collect_deposit"
  | "materials"
  | "schedule_install"
  | "waiting"
  | "await_install"
  | "followup"
  | "complete"
  | "generic";

const STEP_META: Record<Step, { icon: typeof Phone; title: string }> = {
  contact: { icon: Phone, title: "Reach out & set the estimate" },
  schedule_estimate: { icon: CalendarClock, title: "Schedule the estimate" },
  estimate_booked: { icon: Ruler, title: "Measure & meet the customer" },
  build_quote: { icon: FileText, title: "Build & send the quote" },
  approve: { icon: ClipboardCheck, title: "Get the quote approved" },
  collect_deposit: { icon: DollarSign, title: "Collect the deposit" },
  materials: { icon: Boxes, title: "Order & prep materials" },
  schedule_install: { icon: Hammer, title: "Schedule the install" },
  waiting: { icon: PauseCircle, title: "Waiting on the customer" },
  await_install: { icon: CalendarClock, title: "Install scheduled" },
  followup: { icon: Receipt, title: "Sign-off & collect the balance" },
  complete: { icon: CheckCircle2, title: "Job complete" },
  generic: { icon: ArrowRight, title: "Next step" },
};

function resolveStep(
  stage: WorkflowStage | null,
  stages: WorkflowStage[],
): Step {
  if (!stage) return "contact";
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const mainline = sorted.filter((s) => !isOffSpine(s));
  const auto = stage.auto_action ?? "none";
  if (auto === "schedule_estimate") return "schedule_estimate";
  if (auto === "build_quote") return "build_quote";
  if (auto === "collect_deposit") return "collect_deposit";
  if (auto === "schedule_install") return "schedule_install";

  const name = stage.name.toLowerCase();
  const first = mainline[0];
  const last = mainline[mainline.length - 1];
  if (first && stage.id === first.id) return "contact";
  if (last && stage.id === last.id) return "complete";
  // Order matters: "Awaiting Customer Response" contains "wait", so approve and
  // follow-up must be tested before the waiting/park check.
  if (/follow|installed|satisf/.test(name)) return "followup";
  if (/response|approv/.test(name)) return "approve";
  if (/wait|hold/.test(name)) return "waiting";
  if (/install/.test(name)) return "await_install";
  if (/material|order|warehouse|stag/.test(name)) return "materials";
  if (/estimate|measur/.test(name)) return "estimate_booked";

  // Position fallback: classify by where the stage sits between the stable
  // auto_action anchors (works even if the stage was renamed).
  const posOf = (aa: string) =>
    sorted.find((s) => s.auto_action === aa)?.position ?? null;
  const pB = posOf("build_quote");
  const pD = posOf("collect_deposit");
  const pI = posOf("schedule_install");
  if (pB != null && pD != null && stage.position > pB && stage.position < pD)
    return "approve";
  if (pD != null && pI != null && stage.position > pD && stage.position < pI)
    return "materials";
  return "generic";
}

/** The next stage on the happy path — skips Lost/Declined off-ramps. */
function nextMainlineStage(
  stage: WorkflowStage | null,
  stages: WorkflowStage[],
): WorkflowStage | null {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  if (!stage) return sorted.find((s) => !isOffSpine(s)) ?? null;
  return (
    sorted.find((s) => s.position > stage.position && !isOffSpine(s)) ?? null
  );
}

/** Bold "ready for next stage" gate — the only way a job advances (manual). */
function AdvanceButton({
  customerId,
  ownerId,
  nextStage,
  label,
  size = "lg",
}: {
  customerId: string;
  ownerId: string | null;
  nextStage: WorkflowStage | null;
  label?: string;
  size?: "sm" | "lg";
}) {
  if (!nextStage) return null;
  return (
    <form action={advanceWorkflow}>
      <input type="hidden" name="id" value={customerId} />
      <input type="hidden" name="to_stage" value={nextStage.id} />
      <input type="hidden" name="to_user" value={ownerId ?? ""} />
      <SubmitButton size={size} pendingText="Advancing…" confirm="Moved to the next stage">
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
}) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const mainline = sorted.filter((s) => !isOffSpine(s));
  const currentIsLost = currentStage ? isLostStage(currentStage) : false;
  const currentIsPark = currentStage ? isParkStage(currentStage) : false;
  const currentIdx = currentStage
    ? mainline.findIndex((s) => s.id === currentStage.id)
    : -1;
  const step = resolveStep(currentStage, stages);
  const nextStage = nextMainlineStage(currentStage, stages);
  const owner = customer.workflow_owner_id ?? null;
  const Meta = STEP_META[step];

  const lostStage = sorted.find((s) => isLostStage(s)) ?? null;
  const waitingStage = sorted.find((s) => isParkStage(s)) ?? null;

  // Resuming from hold should land where the job actually is: on the install
  // stage if it's already booked, else back on the "schedule the install" step.
  const scheduleStage = sorted.find((s) => s.auto_action === "schedule_install") ?? null;
  const installScheduledStage =
    sorted.find((s) => /install.*sched|sched.*install/.test(s.name.toLowerCase())) ?? null;
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
            "Go measure and meet the customer. When you're back with numbers, advance to build the quote."}
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
          Price this job and send the quote. Advance when it&apos;s out to the customer.
        </p>
        <div className="flex flex-wrap gap-2">
          {activeEstimate ? (
            <Link
              href={`/estimates/${activeEstimate.id}/edit`}
              className={buttonVariants({ size: "sm" })}
            >
              Open quote builder
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
          Follow up to get the quote approved. You can mark it approved here once the
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
              <SubmitButton size="sm" pendingText="Creating…" confirm="Work order created">
                <Hammer className="size-3.5" /> Create work order
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
        Create the work order from the approved estimate first (Jobs panel below),
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
        <div className="overflow-x-auto pb-1">
          <ol className="flex min-w-max items-center gap-1">
            {mainline.map((s, i) => {
              const done = currentIdx >= 0 && i < currentIdx;
              const active = currentIdx === i;
              return (
                <li key={s.id} className="flex items-center gap-1">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : done
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {done ? (
                      <Check className="size-3" />
                    ) : (
                      <span className="tabular-nums opacity-70">{i + 1}</span>
                    )}
                    {s.name}
                  </span>
                  {i < mainline.length - 1 ? (
                    <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
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

          {/* Ready for next stage? — manual gate (nothing auto-advances) */}
          {!currentIsLost && !currentIsPark && step !== "complete" ? (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <AdvanceButton
                customerId={customer.id}
                ownerId={owner}
                nextStage={nextStage}
              />
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

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
  ArrowRight,
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
import { advanceWorkflow } from "../actions";
import { bookInstall } from "@/app/(app)/jobs/actions";
import { EstimateScheduler } from "./estimate-scheduler";
import { JobMaterialsCard } from "@/app/(app)/jobs/[id]/job-materials-card";

type InstallPop = {
  jobId: string;
  days: number;
  suggestions: {
    installerId: string;
    name: string;
    days: number;
    start: string;
    end: string;
  }[];
} | null;

type Step =
  | "contact"
  | "schedule_estimate"
  | "build_quote"
  | "collect_deposit"
  | "materials"
  | "schedule_install"
  | "balance"
  | "complete"
  | "generic";

const STEP_META: Record<Step, { icon: typeof Phone; title: string }> = {
  contact: { icon: Phone, title: "Reach out & set the estimate" },
  schedule_estimate: { icon: CalendarClock, title: "Schedule the estimate" },
  build_quote: { icon: FileText, title: "Build & send the quote" },
  collect_deposit: { icon: DollarSign, title: "Collect the deposit" },
  materials: { icon: Boxes, title: "Get materials ready" },
  schedule_install: { icon: Hammer, title: "Schedule the install" },
  balance: { icon: Receipt, title: "Collect the balance" },
  complete: { icon: CheckCircle2, title: "Job complete" },
  generic: { icon: ArrowRight, title: "Next step" },
};

function resolveStep(
  stage: WorkflowStage | null,
  stages: WorkflowStage[],
): Step {
  if (!stage) return "contact";
  const auto = stage.auto_action ?? "none";
  if (auto === "schedule_estimate") return "schedule_estimate";
  if (auto === "build_quote") return "build_quote";
  if (auto === "collect_deposit") return "collect_deposit";
  if (auto === "schedule_install") return "schedule_install";
  const name = stage.name.toLowerCase();
  const first = [...stages].sort((a, b) => a.position - b.position)[0];
  const last = [...stages].sort((a, b) => b.position - a.position)[0];
  if (first && stage.id === first.id) return "contact";
  if (/material|warehouse|order/.test(name)) return "materials";
  if (/invoic|payment|balance|paid/.test(name)) return "balance";
  if (last && stage.id === last.id) return "complete";
  return "generic";
}

function nextStageOf(
  stage: WorkflowStage | null,
  stages: WorkflowStage[],
): WorkflowStage | null {
  if (!stage) return null;
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((s) => s.id === stage.id);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
}

/** Small button that advances to the next stage (reuses advanceWorkflow). */
function AdvanceButton({
  customerId,
  ownerId,
  nextStage,
  label,
}: {
  customerId: string;
  ownerId: string | null;
  nextStage: WorkflowStage | null;
  label: string;
}) {
  if (!nextStage) return null;
  return (
    <form action={advanceWorkflow}>
      <input type="hidden" name="id" value={customerId} />
      <input type="hidden" name="to_stage" value={nextStage.id} />
      <input type="hidden" name="to_user" value={ownerId ?? ""} />
      <SubmitButton size="sm" pendingText="Moving…" confirm="Moved to next step">
        {label} <ArrowRight className="size-3.5" />
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
  installPop,
}: {
  customer: Customer;
  stages: WorkflowStage[];
  currentStage: WorkflowStage | null;
  estimates: Estimate[];
  jobs: Job[];
  invoices: Invoice[];
  repOptions: { id: string; name: string }[];
  installPop: InstallPop;
}) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const step = resolveStep(currentStage, stages);
  const nextStage = nextStageOf(currentStage, stages);
  const owner = customer.workflow_owner_id ?? null;
  const Meta = STEP_META[step];

  const activeEstimate =
    estimates.find((e) => e.status === "draft") ??
    estimates.find((e) => e.status === "sent") ??
    estimates.find((e) => e.status === "approved") ??
    estimates[0] ??
    null;
  const approvedEstimate = estimates.find((e) => e.status === "approved") ?? null;
  const activeJob =
    jobs.find((j) => j.status !== "completed" && j.status !== "cancelled") ??
    jobs[0] ??
    null;

  const currentIdx = currentStage
    ? sorted.findIndex((s) => s.id === currentStage.id)
    : -1;

  // Step body
  let body: React.ReactNode = null;

  if (step === "contact") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          New lead. Log your first call or text in the Activity panel below, then
          book the in-home estimate or showroom visit.
        </p>
        <EstimateScheduler customerId={customer.id} autoOpen reps={repOptions} />
      </div>
    );
  } else if (step === "schedule_estimate") {
    body = (
      <EstimateScheduler customerId={customer.id} autoOpen reps={repOptions} />
    );
  } else if (step === "build_quote") {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Price this job and send the quote. When the customer approves it, this
          moves to collecting the deposit automatically.
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
            <FileText className="size-3.5" /> Smart builder (by floor type)
          </Link>
          {!activeEstimate && customer.source ? (
            <Link
              href={`/estimates/new?customer=${customer.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              Wizard
            </Link>
          ) : null}
        </div>
      </div>
    );
  } else if (step === "collect_deposit") {
    const depositInvoice = invoices.find((i) => i.status !== "void");
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Approved! Create the deposit invoice and collect it. Recording the
          payment moves this to materials automatically.
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
    if (activeJob) {
      const mats = await getJobMaterials(activeJob.id);
      body = (
        <div className="space-y-3">
          <JobMaterialsCard data={mats} />
          <div className="flex justify-end">
            <AdvanceButton
              customerId={customer.id}
              ownerId={owner}
              nextStage={nextStage}
              label="Materials ready → next"
            />
          </div>
        </div>
      );
    } else {
      body = (
        <p className="text-sm text-muted-foreground">
          No job yet. Create the job from the approved estimate (Jobs panel
          below), then materials will show here.
        </p>
      );
    }
  } else if (step === "schedule_install") {
    body = (
      <div className="space-y-2">
        {!installPop || installPop.suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {installPop
              ? "Add material types/quantities to the estimate, or set crew capacity in Settings → Scheduling."
              : "Create the job first, then install times will suggest here."}
          </p>
        ) : (
          installPop.suggestions.slice(0, 4).map((sug) => (
            <div
              key={sug.installerId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <div>
                <span className="font-medium">{sug.name}</span>{" "}
                <span className="text-muted-foreground">
                  — {sug.days} day{sug.days === 1 ? "" : "s"},{" "}
                  {formatDate(sug.start)}
                  {sug.end !== sug.start ? ` → ${formatDate(sug.end)}` : ""}
                </span>
              </div>
              <form action={bookInstall}>
                <input type="hidden" name="job_id" value={installPop.jobId} />
                <input type="hidden" name="installer_id" value={sug.installerId} />
                <input type="hidden" name="start" value={sug.start} />
                <input type="hidden" name="end" value={sug.end} />
                <SubmitButton
                  size="sm"
                  variant="outline"
                  pendingText="Booking…"
                  confirm="Install booked"
                >
                  Book
                </SubmitButton>
              </form>
            </div>
          ))
        )}
        {installPop ? (
          <Link
            href={`/jobs/${installPop.jobId}`}
            className="text-xs text-primary hover:underline"
          >
            Open job for manual scheduling →
          </Link>
        ) : null}
      </div>
    );
  } else if (step === "balance") {
    const open = invoices
      .filter((i) => i.status !== "void")
      .map((i) => ({
        inv: i,
        bal: invoiceTotals(i.items ?? [], i.tax_rate, amountPaid(i)).balance,
      }))
      .filter((x) => x.bal > 0.005);
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Job&apos;s done — collect what&apos;s left.
        </p>
        {open.length === 0 ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">Nothing outstanding.</p>
            <AdvanceButton
              customerId={customer.id}
              ownerId={owner}
              nextStage={nextStage}
              label="Close job"
            />
          </div>
        ) : (
          open.map(({ inv, bal }) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span>
                {inv.number || "Invoice"} —{" "}
                <span className="font-medium">{formatMoney(bal)} due</span>
              </span>
              <Link
                href={`/invoices/${inv.id}`}
                className={buttonVariants({ size: "sm" })}
              >
                Record payment
              </Link>
            </div>
          ))
        )}
      </div>
    );
  } else if (step === "complete") {
    body = (
      <p className="text-sm text-muted-foreground">
        🎉 This job is complete. Nothing left to do — nice work.
      </p>
    );
  } else {
    body = (
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {currentStage?.next_action || "Move this lead to the next stage."}
        </p>
        <AdvanceButton
          customerId={customer.id}
          ownerId={owner}
          nextStage={nextStage}
          label={nextStage ? `→ ${nextStage.name}` : "Done"}
        />
      </div>
    );
  }

  return (
    <div className="mb-6 space-y-3">
      {/* Progress: clear current-step label + a simple segmented bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">
            {currentStage
              ? `Step ${currentIdx + 1} of ${sorted.length} · ${currentStage.name}`
              : "Not started"}
          </span>
          {nextStage ? (
            <span className="text-muted-foreground">Next: {nextStage.name}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {sorted.map((s, i) => {
            const done = currentIdx >= 0 && i < currentIdx;
            const active = currentIdx === i;
            return (
              <div
                key={s.id}
                title={s.name}
                className={cn(
                  "h-2 flex-1 rounded-full",
                  active ? "bg-primary" : done ? "bg-primary/50" : "bg-muted",
                )}
              />
            );
          })}
        </div>
      </div>

      {/* Do this next */}
      <Card className="border-primary/40 ring-1 ring-primary/20">
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Meta.icon className="size-4" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Do this next
              </p>
              <p className="font-semibold">{Meta.title}</p>
            </div>
          </div>
          {body}
        </CardContent>
      </Card>
    </div>
  );
}

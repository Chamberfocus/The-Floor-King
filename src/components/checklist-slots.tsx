import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Send, Warehouse, Hammer } from "lucide-react";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { setEstimateStatus } from "@/app/(app)/estimates/actions";
import { setJobStatus, submitJobToWarehouse } from "@/app/(app)/jobs/actions";
import { checklistCanOneTapApprove } from "@/lib/estimate-approve-ui";

/**
 * The checklist steps that are a DECISION, not a tool.
 *
 * Fourteen steps spread across eight screens was the complaint, and most of the
 * bouncing wasn't for real work — it was to press one button. Sending a quote,
 * marking it approved, handing a job to the warehouse, saying the install is
 * done: each of those is a single action, and each sent you to another page to
 * do it and left you there.
 *
 * They're buttons on the row now. The steps that genuinely need a tool — build
 * the estimate, raise the PO, record a payment, close the job out — still open
 * the tool, because a builder doesn't belong on a checklist row.
 *
 * Built in ONE place so the customer file and the work order can't drift into
 * offering different actions for the same step, which is how you end up not
 * trusting either.
 */
export function buildChecklistSlots({
  estimate,
  job,
  backTo,
}: {
  /** The estimate this checklist is about, if there is one. */
  estimate: {
    id: string;
    status: string;
    optionIds?: readonly string[];
  } | null;
  /** The work order, once it exists. */
  job: { id: string; status: string | null; warehouseSubmittedAt: string | null } | null;
  /** Where to land afterwards — the page hosting the checklist, so the action
   *  returns you to the list you were reading instead of the record's page. */
  backTo: string;
}): Record<string, ReactNode> {
  const slots: Record<string, ReactNode> = {};

  const estimateForm = (status: string, children: ReactNode, confirm: string, extra?: ReactNode) => (
    <form action={setEstimateStatus}>
      <input type="hidden" name="id" value={estimate!.id} />
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="redirect_to" value={backTo} />
      {extra}
      <SubmitButton size="sm" confirm={confirm} pendingText="Saving…">
        {children}
      </SubmitButton>
    </form>
  );

  if (estimate && estimate.status === "draft") {
    slots.send = estimateForm(
      "sent",
      <>
        <Send className="size-3.5" /> Send it
      </>,
      "Send this estimate? This marks it sent. Email only goes out if sending is configured and customer notifications are on.",
    );
  }

  // Approved on the phone is the normal case — the customer says yes while
  // you're stood in their kitchen, not by clicking a link.
  if (estimate && (estimate.status === "sent" || estimate.status === "draft")) {
    const optionIds = estimate.optionIds ?? [];
    if (checklistCanOneTapApprove(optionIds)) {
      slots.approve = (
        <form action={setEstimateStatus}>
          <input type="hidden" name="id" value={estimate.id} />
          <input type="hidden" name="status" value="approved" />
          <input type="hidden" name="accepted_option_id" value={optionIds[0]} />
          <input type="hidden" name="redirect_to" value={backTo} />
          <ConfirmButton
            size="sm"
            title="Approve this estimate?"
            description="Approves the only priced option. Use the estimate page if you need a different package."
            confirmLabel="Approve"
          >
            <Check className="size-3.5" /> Mark approved
          </ConfirmButton>
        </form>
      );
    } else {
      slots.approve = (
        <Link
          href={`/estimates/${estimate.id}#workflow`}
          className="inline-flex h-8 items-center rounded-md border border-input px-2.5 text-xs font-medium hover:bg-muted"
        >
          Pick option &amp; approve
        </Link>
      );
    }
  }

  if (job && !job.warehouseSubmittedAt) {
    slots.staging = (
      <form action={submitJobToWarehouse}>
        <input type="hidden" name="job_id" value={job.id} />
        <SubmitButton size="sm" confirm="Sent to the warehouse" pendingText="Sending…">
          <Warehouse className="size-3.5" /> Send to the warehouse
        </SubmitButton>
      </form>
    );
  }

  if (job && job.status !== "completed" && job.status !== "cancelled") {
    slots.install = (
      <form action={setJobStatus}>
        <input type="hidden" name="id" value={job.id} />
        <input type="hidden" name="status" value="completed" />
        <SubmitButton size="sm" confirm="Install marked complete" pendingText="Saving…">
          <Hammer className="size-3.5" /> Install is done
        </SubmitButton>
      </form>
    );
  }

  return slots;
}

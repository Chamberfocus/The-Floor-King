"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendMaterialNotice } from "@/app/(app)/jobs/material-notice-actions";
import type { MaterialIssueKind, MaterialNoticeKind } from "@/lib/material-notice";

const CHOICES: {
  kind: MaterialNoticeKind;
  label: string;
  hint: string;
  needsReady?: boolean;
}[] = [
  {
    kind: "all",
    label: "Everything has arrived",
    hint: "Tell the customer the material is complete and that someone will call to schedule.",
    needsReady: true,
  },
  {
    kind: "partial",
    label: "Some of it has arrived",
    hint: "Tell the customer we are still waiting on the rest before we can schedule.",
  },
  {
    kind: "hold",
    label: "Do not tell the customer yet",
    hint: "The store knows the material status. The customer hears nothing for now.",
  },
];

function ChoiceForm({
  jobId,
  kind,
  label,
  hint,
  blocked,
  current,
}: {
  jobId: string;
  kind: MaterialNoticeKind;
  label: string;
  hint: string;
  blocked: boolean;
  current: boolean;
}) {
  const [state, action] = useActionState(sendMaterialNotice, { error: null });
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="kind" value={kind} />
      <SubmitButton
        variant={current ? "default" : "outline"}
        size="sm"
        className="h-auto min-h-11 w-full flex-col items-start gap-0.5 whitespace-normal px-3 py-2 text-left"
        disabled={blocked || current}
        pendingText="Sending…"
        confirm={
          kind === "hold" ? "Saved. The customer was not notified." : "The customer was notified."
        }
      >
        <span className="font-medium">{label}</span>
        <span className="text-xs font-normal opacity-80">
          {blocked
            ? "Available once the warehouse marks the material ready to install."
            : hint}
        </span>
      </SubmitButton>
      {state.error ? (
        <p className="text-xs text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The decision the warehouse does not make. Admin, the account owner, and the
 * salesperson pick one sentence for the customer. Everyone else sees the choice
 * that was already made.
 */
export function MaterialNoticeCard({
  jobId,
  jobTitle,
  ready,
  decision,
  issue,
  issueDetail,
  canDecide,
}: {
  jobId: string;
  jobTitle: string | null;
  ready: boolean;
  decision: MaterialNoticeKind | null;
  issue: MaterialIssueKind | null;
  issueDetail: string | null;
  canDecide: boolean;
}) {
  const status =
    decision === "all"
      ? "The customer was told that everything has arrived and that someone will call to schedule."
      : decision === "partial"
        ? "The customer was told that some material has arrived and the rest is still on the way."
        : "The customer has not been told yet.";

  return (
    <section className="rounded-lg border bg-card p-3">
      <h2 className="text-sm font-semibold">
        Tell {jobTitle ? jobTitle : "the customer"} about this material
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {ready
          ? "The warehouse confirmed this material is complete and ready to install."
          : "The warehouse has not marked this material complete and ready to install."}{" "}
        {status}
      </p>
      {issue && issueDetail ? (
        <p className="mt-2 text-sm">
          <span className="font-medium">
            {issue === "damaged" ? "Damaged" : "Missing"}:
          </span>{" "}
          {issueDetail}
        </p>
      ) : null}
      {canDecide ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {CHOICES.map((choice) => (
            <ChoiceForm
              key={choice.kind}
              jobId={jobId}
              kind={choice.kind}
              label={choice.label}
              hint={choice.hint}
              blocked={!!choice.needsReady && !ready}
              current={decision === choice.kind}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          The admin, the account owner, and this customer&apos;s salesperson choose what the customer hears.
        </p>
      )}
    </section>
  );
}

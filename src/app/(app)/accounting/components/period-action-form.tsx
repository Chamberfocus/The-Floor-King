"use client";

import { IdempotencyField } from "./idempotency-field";

export function PeriodActionForm(props: {
  periodId: string;
  action: (formData: FormData) => Promise<void>;
  label: string;
  reasonPlaceholder: string;
}) {
  return (
    <form action={props.action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="period_id" value={props.periodId} />
      <IdempotencyField />
      <input
        type="text"
        name="reason"
        required
        placeholder={props.reasonPlaceholder}
        className="min-w-[10rem] rounded-md border px-2 py-1 text-xs"
      />
      <button type="submit" className="underline text-xs">
        {props.label}
      </button>
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
} from "@/lib/types";
import { createExpense, type ExpenseFormState } from "./actions";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const initialState: ExpenseFormState = { error: null };

export function ExpenseForm({
  jobs,
}: {
  jobs: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    createExpense,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      toast.success("Expense recorded");
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="date">Date</Label>
        <Input id="date" name="date" type="date" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="category">Category</Label>
        <select id="category" name="category" className={fieldClass} defaultValue="materials">
          {EXPENSE_CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {EXPENSE_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          name="amount"
          type="number"
          step="0.01"
          min="0"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="vendor">Vendor</Label>
        <Input id="vendor" name="vendor" placeholder="Who you paid" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="note">Note</Label>
        <Input id="note" name="note" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="job_id">Link to a job (optional)</Label>
        <select id="job_id" name="job_id" className={fieldClass} defaultValue="">
          <option value="">— None —</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving…" : "Add expense"}
        </Button>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive sm:col-span-3" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

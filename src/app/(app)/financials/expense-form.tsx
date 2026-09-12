"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_ORDER,
} from "@/lib/types";
import {
  createExpense,
  extractBillDocument,
  type ExpenseFormState,
} from "./actions";
import { OperationIdempotencyField } from "@/app/(app)/invoices/payment-idempotency-field";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [opEpoch, setOpEpoch] = useState(0);

  useEffect(() => {
    if (state.ok) {
      toast.success("Expense recorded");
      formRef.current?.reset();
      setOpEpoch((n) => n + 1);
    }
  }, [state]);

  const setField = (name: string, value: string) => {
    const el = formRef.current?.elements.namedItem(name) as
      | HTMLInputElement
      | null;
    if (el) el.value = value;
  };

  const onBill = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    setReading(true);
    const fd = new FormData();
    fd.set("file", f);
    const res = await extractBillDocument(fd);
    setReading(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const d = res.data;
    if (!d) return;
    if (d.vendor) setField("vendor", d.vendor);
    if (d.amount != null) setField("amount", String(d.amount));
    if (d.date) setField("date", d.date);
    toast.success("Bill read — review the details and save");
  };

  return (
    <div className="space-y-3">
      <div>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={onBill}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={reading}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="size-3.5" />{" "}
          {reading ? "Reading bill…" : "Upload a bill to auto-fill"}
        </Button>
      </div>
      <form
        ref={formRef}
        action={formAction}
        className="grid gap-3 sm:grid-cols-3"
      >
      <OperationIdempotencyField key={opEpoch} />
      <div className="space-y-1">
        <Label htmlFor="date">Date</Label>
        <DateField id="date" name="date" />
      </div>
      <div className="space-y-1">
        <Label>Category</Label>
        <SegmentedField
          name="category"
          defaultValue="materials"
          options={EXPENSE_CATEGORY_ORDER.map((c) => ({
            value: c,
            label: EXPENSE_CATEGORY_LABELS[c],
          }))}
        />
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
      <div className="space-y-1 sm:col-span-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">Already paid — not a vendor bill</p>
        <p className="text-muted-foreground">
          Use Bills when you still owe the vendor. This screen is only for cash/card/bank
          costs that are already settled.
        </p>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" name="ack_unlinked" value="yes" className="mt-1" required />
          <span>I confirm this is an already-paid expense, not an unpaid vendor invoice.</span>
        </label>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label>Link to a job (optional)</Label>
        <SearchPicker
          name="job_id"
          placeholder="— None —"
          allowClear
          options={jobs.map((j) => ({ value: j.id, label: j.label }))}
        />
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
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { addActivity, type CustomerFormState } from "../actions";

const initialState: CustomerFormState = { error: null };

export function AddActivityForm({ customerId }: { customerId: string }) {
  const [state, formAction, pending] = useActionState(addActivity, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      toast.success("Logged to timeline");
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <textarea
        name="body"
        rows={2}
        required
        placeholder="Log a call, text, or note…"
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <SegmentedField
          name="type"
          defaultValue="note"
          options={[
            { value: "note", label: "Note" },
            { value: "call", label: "Call" },
            { value: "text", label: "Text" },
            { value: "email", label: "Email" },
          ]}
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  sendInstallerUpdate,
  type InstallerUpdateState,
} from "./update-actions";

const initial: InstallerUpdateState = { error: null };

export function InstallerUpdateForm({ jobId }: { jobId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(sendInstallerUpdate, initial);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.note ? `Update sent. ${state.note}` : "Update sent.");
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
        <Megaphone className="size-4 text-primary" />
        Send an update
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Store, salesperson, customer
        </span>
      </summary>
      <form ref={formRef} action={action} className="mt-3 space-y-3">
        <input type="hidden" name="job_id" value={jobId} />
        <textarea
          name="body"
          required
          rows={3}
          maxLength={800}
          placeholder="What should they know? For example: finished the living room, back tomorrow morning."
          className="w-full rounded-md border px-3 py-2 text-base"
        />
        <fieldset className="space-y-2 text-sm">
          <legend className="text-xs font-medium text-muted-foreground">
            Who should hear this
          </legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="tell_store" defaultChecked className="size-5 accent-primary" />
            The store
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="tell_sales" className="size-5 accent-primary" />
            The salesperson
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="tell_customer" className="size-5 accent-primary" />
            The customer
          </label>
          <p className="text-xs text-muted-foreground">
            The customer only sees this on their phone and in email if you check The customer.
            The store and the salesperson see it in Shop talk.
          </p>
        </fieldset>
        <Button type="submit" disabled={pending} className="min-h-11 w-full">
          {pending ? "Sending…" : "Send update"}
        </Button>
      </form>
    </details>
  );
}

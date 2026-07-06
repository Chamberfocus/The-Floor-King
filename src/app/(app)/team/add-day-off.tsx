"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarPlus, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { requestDayOff, type DayOffState } from "./actions";

const initial: DayOffState = { error: null };

export function AddDayOff({
  isManager,
  members,
}: {
  isManager: boolean;
  members: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(requestDayOff, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && !state.pending) {
      toast.success("Day off approved");
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  // Reset the transient result when the dialog is reopened.
  const onOpenChange = (v: boolean) => {
    setOpen(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button size="lg" />}>
        <CalendarPlus className="size-4" /> Request day off
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a day off</DialogTitle>
        </DialogHeader>

        {state.ok && state.pending ? (
          // Coverage clash → sent for approval.
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Sent for approval</p>
                <p>
                  {state.conflicts && state.conflicts.length
                    ? `${state.conflicts.join(", ")} ${
                        state.conflicts.length > 1 ? "are" : "is"
                      } already off then, so a manager needs to approve your request.`
                    : "A manager needs to approve your request."}
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  formRef.current?.reset();
                  setOpen(false);
                }}
              >
                Got it
              </Button>
            </div>
          </div>
        ) : (
          <form ref={formRef} action={formAction} className="space-y-4">
            {isManager ? (
              <div>
                <label className="mb-1 block text-sm font-medium">Who</label>
                <SearchPicker
                  name="user_id"
                  defaultValue=""
                  placeholder="Choose a person…"
                  options={members.map((m) => ({ value: m.id, label: m.name }))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave blank to request for yourself.
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium">From</label>
                <Input type="date" name="start_date" required />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  To <span className="text-muted-foreground">(optional)</span>
                </label>
                <Input type="date" name="end_date" />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Type</label>
              <SegmentedField
                name="kind"
                defaultValue="off"
                options={[
                  { value: "off", label: "Day off" },
                  { value: "vacation", label: "Vacation" },
                  { value: "sick", label: "Sick" },
                  { value: "personal", label: "Personal" },
                ]}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Note <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input name="note" placeholder="e.g. doctor appointment" />
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" />
              Approved automatically unless someone&apos;s already off those days.
            </p>

            {state.error ? (
              <p className="text-sm text-destructive" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Submit request"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

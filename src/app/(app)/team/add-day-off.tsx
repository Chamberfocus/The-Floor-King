"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CalendarPlus } from "lucide-react";
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
import { addDayOff, type DayOffState } from "./actions";

const initial: DayOffState = { error: null };

export function AddDayOff({
  isManager,
  members,
}: {
  /** Managers (admin/office) can post a day off for anyone. */
  isManager: boolean;
  members: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addDayOff, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      toast.success("Day off posted");
      formRef.current?.reset();
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="lg" />}>
        <CalendarPlus className="size-4" /> Add day off
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a day off</DialogTitle>
        </DialogHeader>
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
                Leave blank to post it for yourself.
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
              {pending ? "Saving…" : "Post day off"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

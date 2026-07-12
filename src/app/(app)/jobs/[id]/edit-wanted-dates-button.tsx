"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { updateWantedDates } from "../actions";

/**
 * Change the dates the customer wants the job done — usable while it's on the
 * board or assigned to an installer. Saves and (if assigned) notifies the crew.
 */
export function EditWantedDatesButton({
  jobId,
  wantedStart,
  wantedEnd,
  expectedDays,
  assigned = false,
  size = "sm",
  variant = "outline",
  label = "Edit requested dates",
}: {
  jobId: string;
  wantedStart?: string | null;
  wantedEnd?: string | null;
  expectedDays?: number | null;
  assigned?: boolean;
  size?: "sm" | "default" | "lg" | "icon-sm";
  variant?: "outline" | "ghost" | "default";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        <CalendarClock className="size-3.5" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Requested dates</DialogTitle>
            <DialogDescription>
              The dates the customer wants the job done.
              {assigned ? " The assigned installer will be notified of the change." : ""}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("id", jobId);
              start(async () => {
                await updateWantedDates(fd);
                setOpen(false);
                router.refresh();
                toast.success(
                  assigned ? "Dates updated — installer notified." : "Requested dates updated.",
                );
              });
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>From</Label>
                <DateField name="wanted_start" defaultValue={wantedStart ?? ""} className="mt-1" />
              </div>
              <div>
                <Label>To (optional)</Label>
                <DateField name="wanted_end" defaultValue={wantedEnd ?? ""} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Expected days</Label>
              <Input
                name="expected_days"
                type="number"
                step="0.5"
                min="0"
                defaultValue={expectedDays ?? ""}
                className="mt-1 w-28"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save dates"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

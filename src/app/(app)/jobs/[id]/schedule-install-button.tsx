"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

/**
 * The install-scheduler icon on the job page — opens the SAME smart scheduler
 * (suggested crews + estimate + manual booking) the customer file uses. The
 * scheduler itself is rendered server-side and passed in as a node.
 */
export function ScheduleInstallButton({
  scheduler,
  scheduled,
}: {
  scheduler: React.ReactNode;
  scheduled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={scheduled ? "outline" : "default"}
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <CalendarClock className="size-4" />
        {scheduled ? "Reschedule install" : "Schedule install"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Schedule the install</DialogTitle>
            <DialogDescription>
              Book a suggested crew &amp; date, or set it manually below.
            </DialogDescription>
          </DialogHeader>
          {scheduler}
        </DialogContent>
      </Dialog>
    </>
  );
}

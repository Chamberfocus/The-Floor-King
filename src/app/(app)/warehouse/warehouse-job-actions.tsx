"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, PackageCheck, ClipboardCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptWarehouseJob, completeWarehouseJob } from "../jobs/actions";

export function WarehouseJobActions({
  job,
}: {
  job: {
    id: string;
    warehouse_submitted_at?: string | null;
    warehouse_accepted_at?: string | null;
    warehouse_ready_at?: string | null;
    staging_location?: string | null;
    warehouse_assignee_name: string | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [location, setLocation] = useState("");

  const submitted = !!job.warehouse_submitted_at;
  const accepted = !!job.warehouse_accepted_at;
  const ready = !!job.warehouse_ready_at;

  const doAccept = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("job_id", job.id);
      fd.set("ack", ack ? "on" : "");
      await acceptWarehouseJob(fd);
      setAcceptOpen(false);
      setAck(false);
      toast.success("Job accepted — get it staged");
      router.refresh();
    });

  const doComplete = () =>
    start(async () => {
      if (!location.trim()) {
        toast.error("Enter where it's staged.");
        return;
      }
      const fd = new FormData();
      fd.set("id", job.id);
      fd.set("staging_location", location.trim());
      await completeWarehouseJob(fd);
      setCompleteOpen(false);
      toast.success("Staged and marked ready");
      router.refresh();
    });

  // ---- Ready ----------------------------------------------------------------
  if (ready) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <CheckCircle2 className="size-4 text-emerald-600" />
        <span className="font-medium text-emerald-800 dark:text-emerald-300">
          Staged &amp; ready
        </span>
        {job.staging_location ? (
          <span className="text-muted-foreground">· at {job.staging_location}</span>
        ) : null}
      </div>
    );
  }

  // ---- Not yet submitted ----------------------------------------------------
  if (!submitted) {
    return (
      <p className="text-xs text-muted-foreground">
        Not yet sent to the warehouse — it arrives here automatically once the
        install is scheduled.
      </p>
    );
  }

  // ---- Accepted, needs staging ---------------------------------------------
  if (accepted) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClipboardCheck className="size-4 text-sky-600" />
          Accepted{job.warehouse_assignee_name ? ` by ${job.warehouse_assignee_name}` : ""} — prep in progress
        </div>
        <Button size="sm" onClick={() => setCompleteOpen(true)}>
          <PackageCheck className="size-3.5" /> Mark staged &amp; notify
        </Button>

        <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Staged &amp; ready</DialogTitle>
              <DialogDescription>
                Where is it staged? The installer, salesperson and admin get
                notified it&apos;s ready (and where), and the customer gets a
                brief heads-up.
              </DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor={`loc-${job.id}`}>Staging location</Label>
              <Input
                id={`loc-${job.id}`}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Bay 3, rack A, will-call shelf 12"
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCompleteOpen(false)}
              >
                Cancel
              </Button>
              <Button type="button" disabled={pending} onClick={doComplete}>
                {pending ? "Saving…" : "Mark ready & notify"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ---- Submitted, needs acceptance -----------------------------------------
  return (
    <div>
      <Button size="sm" onClick={() => setAcceptOpen(true)}>
        <ClipboardCheck className="size-3.5" /> Accept &amp; prep
      </Button>

      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept this job</DialogTitle>
            <DialogDescription>
              Confirm before you start pulling material for this job.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input"
            />
            <span>
              I confirm I&apos;ll <strong>cut the right carpet</strong>, make the{" "}
              <strong>right cuts</strong>, and <strong>pull the right material</strong>{" "}
              for this specific job.
            </span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAcceptOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={!ack || pending} onClick={doAccept}>
              {pending ? "Accepting…" : "Accept job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

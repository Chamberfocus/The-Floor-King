"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  UserCog,
  CalendarClock,
  Hammer,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { SearchPicker } from "@/components/ui/search-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDate, formatWallDateTime, to12 } from "@/lib/format";
import type { ArrivalWindow } from "@/lib/format";
import { advanceWorkflow, reassignCustomer } from "../actions";
import { bookInstall } from "@/app/(app)/jobs/actions";
import { EstimateScheduler } from "./estimate-scheduler";
import { CustomerSwitcher } from "./customer-switcher";

type View = "stage" | "assignee" | "estimate" | "install";

type Job = {
  id: string;
  date: string | null;
  endDate: string | null;
  window: string | null;
  installerId: string | null;
  installerName: string | null;
};

const LOST_REASONS = [
  "Price too high",
  "Went with competitor",
  "Changed their mind",
  "Couldn't reach them",
  "Bad timing",
];

function windowLabel(win: string | null): string | null {
  if (!win) return null;
  const [start, end] = win.split("-").map((s) => s.trim());
  if (!start || !end) return null;
  return `${to12(start)}–${to12(end)}`;
}

/**
 * Always-visible bar of the actions staff run most from a customer's file —
 * change stage, reassign the owner, and set/reschedule the estimate & install
 * dates — without digging into tabs or sub-pages. People-pickers are scoped to
 * the right roles for each task (sales for estimates, crew for installs).
 */
export function QuickActions({
  customerId,
  stages,
  currentStageId,
  currentStageName,
  currentOwnerId,
  currentOwnerName,
  ownerDutyLabel,
  reassignOptions,
  repOptions,
  installOptions,
  estimate,
  job,
  arrivalWindows,
}: {
  customerId: string;
  stages: { id: string; name: string }[];
  currentStageId: string | null;
  currentStageName: string | null;
  currentOwnerId: string | null;
  currentOwnerName: string | null;
  ownerDutyLabel: string | null;
  reassignOptions: { id: string; name: string; title: string | null }[];
  repOptions: { id: string; name: string }[];
  installOptions: { id: string; name: string }[];
  estimate: { startsAt: string; rep: string | null } | null;
  job: Job | null;
  arrivalWindows: ArrivalWindow[];
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("stage");
  const [toStage, setToStage] = useState(currentStageId ?? stages[0]?.id ?? "");
  const [toUser, setToUser] = useState(currentOwnerId ?? "");
  const [reason, setReason] = useState("");

  const launch = (v: View) => {
    setView(v);
    if (v === "stage") setToStage(currentStageId ?? stages[0]?.id ?? "");
    if (v === "assignee") setToUser(currentOwnerId ?? "");
    setReason("");
    setOpen(true);
  };

  const targetStage = stages.find((s) => s.id === toStage);
  const isLost = /lost|declin|dead|cancel/i.test(targetStage?.name ?? "");

  const installWindow = windowLabel(job?.window ?? null);

  return (
    <div className="mb-6 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Zap className="size-4 text-primary" /> Quick actions
        </span>

        <Button variant="outline" size="sm" onClick={() => launch("stage")}>
          <ArrowLeftRight className="size-3.5" /> Stage
          {currentStageName ? (
            <span className="ml-1 max-w-[8rem] truncate text-muted-foreground">
              · {currentStageName}
            </span>
          ) : null}
        </Button>

        <Button variant="outline" size="sm" onClick={() => launch("assignee")}>
          <UserCog className="size-3.5" /> Assignee
          <span className="ml-1 max-w-[8rem] truncate text-muted-foreground">
            · {currentOwnerName ?? "Unassigned"}
          </span>
        </Button>

        <Button variant="outline" size="sm" onClick={() => launch("estimate")}>
          <CalendarClock className="size-3.5" /> Estimate
          <span className="ml-1 text-muted-foreground">
            · {estimate ? formatDate(estimate.startsAt) : "Set"}
          </span>
        </Button>

        <Button variant="outline" size="sm" onClick={() => launch("install")}>
          <Hammer className="size-3.5" /> Install
          <span className="ml-1 text-muted-foreground">
            · {job?.date ? formatDate(job.date) : "Set"}
          </span>
        </Button>

        <div className="ml-auto">
          <CustomerSwitcher currentId={customerId} />
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {view === "stage" ? (
            <>
              <DialogHeader>
                <DialogTitle>Change stage</DialogTitle>
                <DialogDescription>
                  Move this customer to another workflow stage. The owner stays
                  the same — use Assignee to hand it off.
                </DialogDescription>
              </DialogHeader>
              <form action={advanceWorkflow} className="space-y-3">
                <input type="hidden" name="id" value={customerId} />
                <input type="hidden" name="to_stage" value={toStage} />
                <input type="hidden" name="to_user" value={currentOwnerId ?? ""} />
                <input type="hidden" name="note" value={isLost ? reason : ""} />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Stage
                  </label>
                  <SearchPicker
                    className="w-full"
                    value={toStage}
                    onChange={setToStage}
                    options={stages.map((s) => ({ value: s.id, label: s.name }))}
                  />
                </div>
                {isLost ? (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-destructive">
                      Why was this lost? (shows in the Win/Loss report)
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {LOST_REASONS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setReason(r)}
                          className={cn(
                            "rounded-md border px-2.5 py-1 text-xs",
                            reason === r
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted",
                          )}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason (or pick one above)"
                      className="h-8"
                    />
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <SubmitButton size="sm" pendingText="Moving…" confirm="Stage updated">
                    Save
                  </SubmitButton>
                </div>
              </form>
            </>
          ) : view === "assignee" ? (
            <>
              <DialogHeader>
                <DialogTitle>Reassign owner</DialogTitle>
                <DialogDescription>
                  {ownerDutyLabel
                    ? `Only ${ownerDutyLabel.toLowerCase()}s are shown for this stage.`
                    : "Hand this customer to another team member."}
                </DialogDescription>
              </DialogHeader>
              <form action={reassignCustomer} className="space-y-3">
                <input type="hidden" name="id" value={customerId} />
                <input type="hidden" name="to_user" value={toUser} />
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Assign to
                  </label>
                  <SearchPicker
                    className="w-full"
                    value={toUser}
                    onChange={setToUser}
                    placeholder="— Unassigned —"
                    allowClear
                    options={reassignOptions.map((m) => ({
                      value: m.id,
                      label: m.name,
                      hint: m.title ?? undefined,
                    }))}
                  />
                  {reassignOptions.length === 0 ? (
                    <p className="mt-1 text-xs text-amber-600">
                      No matching team members — add them in Settings → Team.
                    </p>
                  ) : null}
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <SubmitButton
                    size="sm"
                    pendingText="Saving…"
                    confirm="Owner updated"
                  >
                    Save
                  </SubmitButton>
                </div>
              </form>
            </>
          ) : view === "estimate" ? (
            <>
              <DialogHeader>
                <DialogTitle>Estimate appointment</DialogTitle>
                <DialogDescription>
                  {estimate
                    ? `Booked ${formatWallDateTime(estimate.startsAt)}${
                        estimate.rep ? ` with ${estimate.rep}` : ""
                      }. Pick a new time to reschedule.`
                    : "Find a smart time or book manually. Only salespeople are offered."}
                </DialogDescription>
              </DialogHeader>
              <EstimateScheduler customerId={customerId} reps={repOptions} />
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Install date</DialogTitle>
                <DialogDescription>
                  {job
                    ? "Set or change the install date and crew. Only installers are offered."
                    : "No job yet."}
                </DialogDescription>
              </DialogHeader>
              {job ? (
                <form action={bookInstall} className="space-y-3">
                  <input type="hidden" name="job_id" value={job.id} />
                  {job.date ? (
                    <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      Currently{" "}
                      <span className="font-medium text-foreground">
                        {formatDate(job.date)}
                        {job.endDate && job.endDate !== job.date
                          ? ` – ${formatDate(job.endDate)}`
                          : ""}
                      </span>
                      {installWindow ? ` · ${installWindow}` : ""}
                      {job.installerName ? ` · ${job.installerName}` : ""}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Start date
                      </label>
                      <input
                        type="date"
                        name="start"
                        required
                        defaultValue={job.date ?? ""}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        End date{" "}
                        <span className="text-muted-foreground/70">(optional)</span>
                      </label>
                      <input
                        type="date"
                        name="end"
                        defaultValue={job.endDate ?? ""}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Installer
                    </label>
                    <SearchPicker
                      name="installer_id"
                      className="w-full"
                      defaultValue={job.installerId ?? ""}
                      placeholder="— Choose installer —"
                      allowClear
                      options={installOptions.map((m) => ({
                        value: m.id,
                        label: m.name,
                      }))}
                    />
                    {installOptions.length === 0 ? (
                      <p className="mt-1 text-xs text-amber-600">
                        No installers yet — add crew in Settings → Team.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Arrival window
                    </label>
                    <select
                      name="arrival_window"
                      defaultValue={job.window ?? ""}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      <option value="">No window</option>
                      {arrivalWindows.map((w) => (
                        <option
                          key={`${w.start}-${w.end}`}
                          value={`${w.start}-${w.end}`}
                        >
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpen(false)}
                    >
                      Cancel
                    </Button>
                    <SubmitButton
                      size="sm"
                      pendingText="Saving…"
                      confirm="Install date set"
                    >
                      Save install date
                    </SubmitButton>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">
                  There&apos;s no job to schedule yet. Create the job first (from
                  the approved estimate in the{" "}
                  <Link
                    href="#jobs"
                    className="text-primary hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    Jobs
                  </Link>{" "}
                  panel), then set the install date here.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

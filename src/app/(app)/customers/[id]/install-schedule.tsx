import { CalendarClock, CalendarOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SchedulePush } from "@/components/schedule-push";
import { ArrivalWindowField } from "@/components/ui/arrival-window-field";
import { bookInstall } from "@/app/(app)/jobs/actions";
import { formatDate, to12, type ArrivalWindow } from "@/lib/format";
import { ManualBooking } from "./manual-booking";

/** A crew member's posted unavailability, redacted for the office (private
 *  blocks carry label "Unavailable" only). Used to warn before booking. */
export interface BookingBlock {
  id?: string;
  installerId: string;
  start_date: string;
  end_date: string;
  kind: string;
  is_private: boolean;
  label: string;
}

/** Does an availability block overlap the [start, end] booking window? All
 *  date-only (YYYY-MM-DD), so lexical comparison is correct. */
export function blockOverlaps(
  b: BookingBlock,
  start: string,
  end: string | null,
): boolean {
  const e = end && end >= start ? end : start;
  return b.start_date <= e && b.end_date >= start;
}

/** The blocks (if any) that conflict with booking `installerId` over the window. */
export function conflictsFor(
  blocks: BookingBlock[],
  installerId: string | null,
  start: string | null,
  end: string | null,
): BookingBlock[] {
  if (!installerId || !start) return [];
  return blocks.filter(
    (b) => b.installerId === installerId && blockOverlaps(b, start, end),
  );
}

export interface InstallScheduleProps {
  jobId: string;
  customerId: string;
  jobTitle: string | null;
  schedule: {
    date: string | null;
    endDate: string | null;
    window: string | null;
    installerId: string | null;
    installerName: string | null;
  };
  installEst: { days: number; breakdown: { label: string; amount: number; unit: string; days: number }[] } | null;
  suggestions: { installerId: string; name: string; days: number; start: string; end: string }[];
  /** Every installer you can assign — login installers + login-less subcontractor
   *  crews (value "crew:<id>"). One picker, one assignment. */
  installerUsers: { value: string; label: string }[];
  arrivalWindows: ArrivalWindow[];
  /** The customer's requested install dates (rank order) — a request to confirm. */
  preferences?: string[];
  /** Crew-posted unavailability (redacted), to warn before double-booking. */
  availability?: BookingBlock[];
}

/**
 * The install smart-scheduler — lives on the customer file (its home). Books
 * the install date/crew, offers next-available suggestions, and assigns the
 * managed install crew. The job page shows this read-only and links back here.
 */
export function InstallSchedule({
  jobId,
  customerId,
  jobTitle,
  schedule,
  installEst,
  suggestions,
  installerUsers,
  arrivalWindows,
  preferences = [],
  availability = [],
}: InstallScheduleProps) {
  const redirectTo = `/customers/${customerId}#jobs`;
  const windowLabel = schedule.window
    ? schedule.window.split("-").map((t) => to12(t.trim())).join("–")
    : null;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-primary" /> Install schedule
          {jobTitle ? <span className="font-normal text-muted-foreground">· {jobTitle}</span> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The customer's requested dates (a request — confirm one below). */}
        {!schedule.date && preferences.length ? (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <div className="font-semibold text-primary">Customer requested these dates</div>
            <ol className="mt-1 space-y-0.5">
              {preferences.map((d, i) => (
                <li key={d}>
                  <span className="font-medium">{i + 1}.</span> {formatDate(d)}
                </li>
              ))}
            </ol>
            <p className="mt-1 text-xs text-muted-foreground">
              Confirm one below (assign the installer) to make it official.
            </p>
          </div>
        ) : null}

        {/* Current status */}
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          {schedule.date ? (
            <>
              <span className="font-medium text-foreground">
                {formatDate(schedule.date)}
                {schedule.endDate && schedule.endDate !== schedule.date
                  ? ` – ${formatDate(schedule.endDate)}`
                  : ""}
              </span>
              {windowLabel ? ` · ${windowLabel}` : ""}
              {schedule.installerName ? ` · ${schedule.installerName}` : ""}
            </>
          ) : (
            <span className="text-muted-foreground">Not scheduled yet.</span>
          )}
        </div>

        {installEst && installEst.days > 0 ? (
          <div>
            <div className="text-sm">
              Estimated{" "}
              <span className="font-semibold">
                {installEst.days} day{installEst.days === 1 ? "" : "s"}
              </span>{" "}
              based on your crew capacity:
            </div>
            <ul className="mt-1 text-xs text-muted-foreground">
              {installEst.breakdown.map((b, i) => (
                <li key={i}>
                  • {b.label}: {b.amount.toFixed(0)} {b.unit} → {b.days.toFixed(2)} day(s)
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Smart suggestions */}
        {suggestions.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">
              Next available crews{" "}
              <span className="font-normal text-muted-foreground">({suggestions.length})</span>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto">
            {suggestions.map((sug) => {
              const clash = conflictsFor(availability, sug.installerId, sug.start, sug.end);
              return (
              <div
                key={sug.installerId}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm ${
                  clash.length ? "border-amber-400 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20" : ""
                }`}
              >
                <div>
                  <span className="font-medium">{sug.name}</span>{" "}
                  <span className="text-muted-foreground">
                    — {sug.days} day{sug.days === 1 ? "" : "s"}, {formatDate(sug.start)}
                    {sug.end !== sug.start ? ` → ${formatDate(sug.end)}` : ""}
                  </span>
                  {clash.length ? (
                    <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <CalendarOff className="size-3.5" />
                      {sug.name.split(" ")[0]} marked themselves unavailable
                      {clash.length === 1 ? ` (${clash[0].label})` : ""}
                    </div>
                  ) : null}
                </div>
                <form action={bookInstall} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="job_id" value={jobId} />
                  <input type="hidden" name="installer_id" value={sug.installerId} />
                  <input type="hidden" name="start" value={sug.start} />
                  <input type="hidden" name="end" value={sug.end} />
                  <input type="hidden" name="redirect_to" value={redirectTo} />
                  <ArrivalWindowField
                    label="Arrival window"
                    combinedName="arrival_window"
                    defaultValue={schedule.window ?? ""}
                    presets={arrivalWindows}
                  />
                  <SchedulePush
                    size="sm"
                    variant="outline"
                    assigneeRole="installer"
                    title={`Book ${sug.name} for this install?`}
                    description="The install books and goes to the warehouse either way — choose who to notify."
                    confirmLabel="Book install"
                  >
                    Book
                  </SchedulePush>
                </form>
              </div>
              );
            })}
            </div>
          </div>
        ) : null}

        {/* Manual booking — every installer, always open until the job is booked
            so you can pick anyone (not just the suggested next-available crews).
            Warns live if the picked installer is marked unavailable. */}
        <ManualBooking
          jobId={jobId}
          redirectTo={redirectTo}
          schedule={schedule}
          installerUsers={installerUsers}
          arrivalWindows={arrivalWindows}
          availability={availability}
        />
      </CardContent>
    </Card>
  );
}

import { DateField } from "@/components/ui/date-field";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { SearchPicker } from "@/components/ui/search-picker";
import { bookInstall } from "@/app/(app)/jobs/actions";
import { formatDate, to12, type ArrivalWindow } from "@/lib/format";

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
            {suggestions.map((sug) => (
              <div
                key={sug.installerId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
              >
                <div>
                  <span className="font-medium">{sug.name}</span>{" "}
                  <span className="text-muted-foreground">
                    — {sug.days} day{sug.days === 1 ? "" : "s"}, {formatDate(sug.start)}
                    {sug.end !== sug.start ? ` → ${formatDate(sug.end)}` : ""}
                  </span>
                </div>
                <form action={bookInstall} className="flex items-center gap-1.5">
                  <input type="hidden" name="job_id" value={jobId} />
                  <input type="hidden" name="installer_id" value={sug.installerId} />
                  <input type="hidden" name="start" value={sug.start} />
                  <input type="hidden" name="end" value={sug.end} />
                  <input type="hidden" name="redirect_to" value={redirectTo} />
                  <select
                    name="arrival_window"
                    defaultValue={schedule.window ?? ""}
                    aria-label="Arrival window"
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                  >
                    <option value="">No window</option>
                    {arrivalWindows.map((w) => (
                      <option key={`${w.start}-${w.end}`} value={`${w.start}-${w.end}`}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                  <SubmitButton size="sm" variant="outline" pendingText="Booking…" confirm={null}>
                    Book
                  </SubmitButton>
                </form>
              </div>
            ))}
            </div>
          </div>
        ) : null}

        {/* Manual booking — every installer, always open until the job is booked
            so you can pick anyone (not just the suggested next-available crews). */}
        <details className="border-t pt-3" open={!schedule.date}>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {schedule.date ? "Reschedule manually" : "Pick any installer & date"}
          </summary>
          <form action={bookInstall} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="job_id" value={jobId} />
            <input type="hidden" name="redirect_to" value={redirectTo} />
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Installer</label>
              <SearchPicker
                name="installer_id"
                defaultValue={schedule.installerId ?? ""}
                placeholder="— Choose —"
                allowClear
                options={installerUsers}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Start</label>
              <DateField
                name="start"
                required
                defaultValue={schedule.date ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End</label>
              <DateField
                name="end"
                defaultValue={schedule.endDate ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Arrival window</label>
              <select
                name="arrival_window"
                defaultValue={schedule.window ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">No window</option>
                {arrivalWindows.map((w) => (
                  <option key={`${w.start}-${w.end}`} value={`${w.start}-${w.end}`}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton size="sm" pendingText="Booking…" confirm={null}>
              {schedule.date ? "Save changes" : "Book install"}
            </SubmitButton>
          </form>
        </details>
      </CardContent>
    </Card>
  );
}

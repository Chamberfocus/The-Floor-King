import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { bookInstall, setJobCrew } from "@/app/(app)/jobs/actions";
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
  /** Crew-role users for the manual installer picker. */
  installerUsers: { value: string; label: string }[];
  /** Managed install crews + team installers for the crew assignment. */
  crewOptions: { value: string; label: string }[];
  currentCrew: { id: string; name: string; kind: string; phone: string | null } | null;
  arrivalWindows: ArrivalWindow[];
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
  crewOptions,
  currentCrew,
  arrivalWindows,
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
                  <Button type="submit" size="sm" variant="outline">
                    Book
                  </Button>
                </form>
              </div>
            ))}
            </div>
          </div>
        ) : null}

        {/* Manual booking */}
        <details className="border-t pt-3" open={!schedule.date && suggestions.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {schedule.date ? "Reschedule manually" : "Schedule manually"}
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
              <input
                type="date"
                name="start"
                required
                defaultValue={schedule.date ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">End</label>
              <input
                type="date"
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
            <Button type="submit" size="sm">
              {schedule.date ? "Save changes" : "Book install"}
            </Button>
          </form>
        </details>

        {/* Install crew (managed subs + employees) */}
        <div className="border-t pt-3">
          <div className="mb-1 text-sm font-medium">Install crew</div>
          {currentCrew ? (
            <p className="mb-2 text-sm">
              Assigned to <span className="font-semibold">{currentCrew.name}</span>
              <span className="text-muted-foreground">
                {" "}· {currentCrew.kind === "employee" ? "Employee" : "Subcontractor"}
                {currentCrew.phone ? ` · ${currentCrew.phone}` : ""}
              </span>
            </p>
          ) : null}
          {crewOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No installers yet. Add a{" "}
              <Link href="/settings/team" className="text-primary underline">
                team installer
              </Link>{" "}
              or a{" "}
              <Link href="/settings/install-crews" className="text-primary underline">
                subcontractor crew
              </Link>{" "}
              to assign one here.
            </p>
          ) : (
            <form action={setJobCrew} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="job_id" value={jobId} />
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Assign a crew</label>
                <SearchPicker
                  name="crew_id"
                  defaultValue={currentCrew?.id ?? ""}
                  placeholder="— Choose a crew —"
                  options={crewOptions}
                />
              </div>
              <Button type="submit" size="sm" variant="outline">
                {currentCrew ? "Update crew" : "Assign crew"}
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

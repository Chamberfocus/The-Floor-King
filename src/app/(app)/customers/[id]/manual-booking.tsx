"use client";

import { useState } from "react";
import { CalendarOff, Lock } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { SendToClient } from "@/components/send-to-client";
import { SearchPicker } from "@/components/ui/search-picker";
import { bookInstall } from "@/app/(app)/jobs/actions";
import { formatDate, type ArrivalWindow } from "@/lib/format";
import {
  conflictsFor,
  type BookingBlock,
} from "./install-schedule";

/**
 * The manual install-booking form, as a client island so it can warn the office
 * IN REAL TIME when the picked installer has marked themselves unavailable for
 * the chosen window. The warning never blocks — the office can still book (an
 * override) — it just makes a conflict impossible to miss.
 */
export function ManualBooking({
  jobId,
  redirectTo,
  schedule,
  installerUsers,
  arrivalWindows,
  availability,
}: {
  jobId: string;
  redirectTo: string;
  schedule: {
    date: string | null;
    endDate: string | null;
    window: string | null;
    installerId: string | null;
  };
  installerUsers: { value: string; label: string }[];
  arrivalWindows: ArrivalWindow[];
  availability: BookingBlock[];
}) {
  const [installerId, setInstallerId] = useState(schedule.installerId ?? "");
  const [start, setStart] = useState(schedule.date ?? "");
  const [end, setEnd] = useState(schedule.endDate ?? "");

  const clashes = conflictsFor(availability, installerId || null, start || null, end || null);
  const installerLabel =
    installerUsers.find((u) => u.value === installerId)?.label.split(" · ")[0] ?? "This installer";

  return (
    <details className="border-t pt-3" open={!schedule.date}>
      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
        {schedule.date ? "Reschedule manually" : "Pick any installer & date"}
      </summary>

      {clashes.length ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
          <CalendarOff className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-semibold">
              {installerLabel} marked themselves unavailable for{" "}
              {clashes.length === 1
                ? clashes[0].start_date === clashes[0].end_date
                  ? formatDate(clashes[0].start_date)
                  : `${formatDate(clashes[0].start_date)} – ${formatDate(clashes[0].end_date)}`
                : "these dates"}
              .
            </div>
            <ul className="mt-0.5 space-y-0.5 text-xs">
              {clashes.map((c) => (
                <li key={c.id ?? `${c.start_date}-${c.label}`} className="flex items-center gap-1">
                  {c.is_private ? <Lock className="size-3" /> : null}
                  {c.label}
                  {c.start_date !== c.end_date
                    ? ` · ${formatDate(c.start_date)}–${formatDate(c.end_date)}`
                    : ` · ${formatDate(c.start_date)}`}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-xs">You can still book — this is just a heads-up.</div>
          </div>
        </div>
      ) : null}

      <form action={bookInstall} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="job_id" value={jobId} />
        <input type="hidden" name="redirect_to" value={redirectTo} />
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Installer</label>
          <SearchPicker
            name="installer_id"
            value={installerId}
            onChange={setInstallerId}
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
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">End</label>
          <DateField
            name="end"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
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
        <SendToClient
          size="sm"
          title={schedule.date ? "Reschedule this install?" : "Book this install?"}
          description={
            (clashes.length
              ? `Heads up: ${installerLabel} marked themselves unavailable for this window. `
              : "") +
            "The install books and goes to the warehouse either way. Send emails the customer their date & arrival window."
          }
          sendLabel={schedule.date ? "Save & notify" : "Book & notify"}
          skipLabel={schedule.date ? "Save, no email" : "Book, no email"}
        >
          {schedule.date ? "Save changes" : "Book install"}
        </SendToClient>
      </form>
    </details>
  );
}

import { CalendarClock, Wrench } from "lucide-react";
import { formatDate, formatWallTime, to12 } from "@/lib/format";

/** "08:00-10:00" → "8–10 AM". Empty/invalid → null. */
function windowLabel(win: string | null | undefined): string | null {
  if (!win) return null;
  const [start, end] = win.split("-").map((s) => s.trim());
  if (!start || !end) return null;
  return `${to12(start)}–${to12(end)}`;
}

/**
 * At-a-glance schedule strip shown right under the customer's stage: when the
 * estimate is booked (date · time · rep) and when the install is booked
 * (date · arrival window · installer). Rows only appear once scheduled.
 */
export function ScheduleSummary({
  estimate,
  install,
}: {
  estimate: { startsAt: string; rep: string | null } | null;
  install: {
    date: string;
    endDate: string | null;
    window: string | null;
    installer: string | null;
  } | null;
}) {
  if (!estimate && !install) return null;

  const installWindow = windowLabel(install?.window);
  const installDates =
    install &&
    (install.endDate && install.endDate !== install.date
      ? `${formatDate(install.date)} – ${formatDate(install.endDate)}`
      : formatDate(install.date));

  return (
    <div className="mt-2 flex flex-col gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
      {estimate ? (
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-4 text-primary" />
          <span className="text-muted-foreground">Estimate:</span>
          <span className="font-medium">
            {formatDate(estimate.startsAt)} · {formatWallTime(estimate.startsAt)}
          </span>
          {estimate.rep ? (
            <span className="text-muted-foreground">· {estimate.rep}</span>
          ) : null}
        </span>
      ) : null}
      {install ? (
        <span className="inline-flex items-center gap-1.5">
          <Wrench className="size-4 text-primary" />
          <span className="text-muted-foreground">Install:</span>
          <span className="font-medium">
            {installDates}
            {installWindow ? ` · ${installWindow}` : ""}
          </span>
          {install.installer ? (
            <span className="text-muted-foreground">· {install.installer}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

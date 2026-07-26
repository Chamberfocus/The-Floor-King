import { CalendarOff, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { OfficeAvailabilityBlock } from "@/lib/data/crew-availability";

function fmtRange(b: OfficeAvailabilityBlock): string {
  const days =
    b.start_date === b.end_date
      ? formatDate(b.start_date)
      : `${formatDate(b.start_date)} – ${formatDate(b.end_date)}`;
  if (b.all_day || !b.start_time) return days;
  return `${days} · ${b.start_time}${b.end_time ? `–${b.end_time}` : ""}`;
}

/**
 * What the office sees of crew availability. Every field here already comes
 * redacted from installer_availability_office() — a private block arrives as
 * label "Unavailable" with no note, so customer details never reach this view.
 */
export function CrewAvailabilityBoard({
  blocks,
}: {
  blocks: OfficeAvailabilityBlock[];
}) {
  if (blocks.length === 0) return null;

  const byInstaller = new Map<string, OfficeAvailabilityBlock[]>();
  for (const b of blocks) {
    const key = b.installer_name || "Installer";
    (byInstaller.get(key) ?? byInstaller.set(key, []).get(key)!).push(b);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarOff className="size-4 text-primary" /> Installer availability
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          When your crew have told you they’re out — don’t schedule them then.
          Private blocks show only as “Unavailable.”
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {[...byInstaller.entries()].map(([name, list]) => (
          <div key={name}>
            <div className="mb-1 text-sm font-semibold">{name}</div>
            <ul className="space-y-1">
              {list.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-sm"
                >
                  <span className="font-medium tabular-nums">{fmtRange(b)}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {b.label}
                  </span>
                  {b.is_private ? (
                    <Lock className="ml-auto size-3.5 shrink-0 text-primary" />
                  ) : (
                    <span
                      className={
                        b.kind === "busy"
                          ? "ml-auto shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          : "ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
                      }
                    >
                      {b.kind === "busy" ? "Busy" : "Off"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

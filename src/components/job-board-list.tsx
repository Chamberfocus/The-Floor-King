import Link from "next/link";
import { CalendarDays, Check, ClipboardList, Clock, MapPin } from "lucide-react";
import { jobHeading } from "@/lib/job-label";
import { MATERIAL_TYPE_LABEL } from "@/lib/job-scope";
import { formatDate } from "@/lib/format";
import { JOB_DELIVERY_LABELS } from "@/lib/types";
import type { OpenJobRow } from "@/lib/data/jobs";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { applyToJob, withdrawApplication } from "@/app/(app)/jobs/actions";
import { EditWantedDatesButton } from "@/app/(app)/jobs/[id]/edit-wanted-dates-button";

const MATERIAL_TINT: Record<"carpet" | "hard" | "both", string> = {
  carpet: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  hard: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  both: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
};

/** The same claim list the job board and the installer phone both use. */
export function JobBoardList({
  jobs,
  appliedIds,
  isStaff,
}: {
  jobs: OpenJobRow[];
  appliedIds: string[];
  isStaff: boolean;
}) {
  const applied = new Set(appliedIds);
  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No open jobs right now"
        description="Check back soon — posted jobs you can claim will show up here."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {jobs.map((j) => {
        const city = [j.site_city, j.site_state].filter(Boolean).join(", ");
        const hasApplied = applied.has(j.id);
        return (
          <Card key={j.id} className="flex flex-col">
            <CardContent className="flex flex-1 flex-col gap-3 pt-6">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/jobs/${j.id}`} className="text-lg font-semibold hover:underline">
                    {jobHeading(j, j.customer_name)}
                  </Link>
                  {j.materialType ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${MATERIAL_TINT[j.materialType]}`}>
                      {MATERIAL_TYPE_LABEL[j.materialType]}
                    </span>
                  ) : null}
                  {isStaff && j.board_installer_ids && j.board_installer_ids.length ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      🎯 {j.board_installer_ids.length} installer
                      {j.board_installer_ids.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 space-y-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="size-4" />
                    {city || "Address on the job"}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="size-4" />
                    {j.scheduled_date ? (
                      formatDate(j.scheduled_date)
                    ) : j.board_wanted_start ? (
                      <span>
                        Wanted{" "}
                        <span className="font-medium text-foreground">
                          {formatDate(j.board_wanted_start)}
                          {j.board_wanted_end ? ` – ${formatDate(j.board_wanted_end)}` : ""}
                        </span>
                      </span>
                    ) : (
                      "Flexible timing"
                    )}
                  </div>
                  {j.board_expected_days ? (
                    <div className="flex items-center gap-1.5">
                      <Clock className="size-4" />
                      Expected{" "}
                      <span className="font-medium text-foreground">
                        ~{j.board_expected_days} day
                        {j.board_expected_days === 1 ? "" : "s"}
                      </span>
                    </div>
                  ) : null}
                  <div className="text-xs">{JOB_DELIVERY_LABELS[j.delivery_type]}</div>
                </div>
              </div>
              <div className="mt-auto flex gap-2">
                <Link
                  href={`/jobs/${j.id}`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className: "min-h-11 flex-1",
                  })}
                >
                  View details
                </Link>
                {!isStaff ? (
                  hasApplied ? (
                    <form action={withdrawApplication} className="flex-1">
                      <input type="hidden" name="job_id" value={j.id} />
                      <Button type="submit" variant="secondary" size="lg" className="min-h-11 w-full">
                        <Check className="size-4" /> Requested — tap to undo
                      </Button>
                    </form>
                  ) : (
                    <form action={applyToJob} className="flex-1">
                      <input type="hidden" name="job_id" value={j.id} />
                      <Button type="submit" size="lg" className="min-h-11 w-full">
                        Claim this job
                      </Button>
                    </form>
                  )
                ) : (
                  <EditWantedDatesButton
                    jobId={j.id}
                    wantedStart={j.board_wanted_start}
                    wantedEnd={j.board_wanted_end}
                    expectedDays={j.board_expected_days}
                    size="lg"
                    label="Edit dates"
                  />
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

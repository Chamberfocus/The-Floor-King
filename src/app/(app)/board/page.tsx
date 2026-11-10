import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { JobBoardList } from "@/components/job-board-list";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { requireProfile } from "@/lib/auth";
import { getMyApplicationJobIds, listOpenJobs } from "@/lib/data/jobs";

export const metadata: Metadata = { title: "Job Board" };

export default async function JobBoardPage() {
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";
  const [jobs, appliedIds] = await Promise.all([
    listOpenJobs({ id: profile.id, isStaff }),
    getMyApplicationJobIds(),
  ]);

  return (
    <div>
      <RealtimeRefresh table="jobs" />
      <RealtimeRefresh table="job_applications" />
      <PageHeader
        title="Job Board"
        description={
          isStaff
            ? "Jobs posted for installers to claim."
            : "Upcoming jobs you can take. Tap a job to see the details, then claim it."
        }
      />
      <JobBoardList jobs={jobs} appliedIds={appliedIds} isStaff={isStaff} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { JobStatusBadge } from "@/components/job-status-badge";
import { listJobs, listAssignableUsers } from "@/lib/data/jobs";
import { requireProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage() {
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";

  const jobs = await listJobs();
  const users = isStaff ? await listAssignableUsers() : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  return (
    <div>
      <PageHeader
        title="Jobs"
        description={
          isStaff
            ? "Scheduled and active installations."
            : "Your assigned jobs."
        }
      >
        <div className="flex gap-2">
          <Link
            href="/jobs/calendar"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            <CalendarDays className="size-4" /> Calendar
          </Link>
          {isStaff ? (
            <Link
              href="/jobs/quick"
              className={buttonVariants({ size: "lg" })}
            >
              <Plus className="size-4" /> Quick install
            </Link>
          ) : null}
        </div>
      </PageHeader>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {isStaff
            ? "No jobs yet. Approve an estimate and click “Create job” to schedule an install."
            : "No jobs assigned to you yet."}
        </div>
      ) : (
        <>
        {/* Phone: tappable cards */}
        <div className="space-y-2 md:hidden">
          {jobs.map((j) => (
            <Link
              key={j.id}
              href={`/jobs/${j.id}`}
              className="block rounded-lg border p-3 active:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{j.title || "Job"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {j.customer_name ?? "—"}
                  </div>
                </div>
                <JobStatusBadge status={j.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span>
                  {j.scheduled_date ? formatDate(j.scheduled_date) : "Not scheduled"}
                </span>
                {isStaff && j.assigned_to ? (
                  <span className="ml-auto">
                    {nameById.get(j.assigned_to) ?? "Assigned"}
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
        {/* Larger screens: table */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                {isStaff ? <TableHead>Crew</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="font-medium">
                    <Link href={`/jobs/${j.id}`} className="hover:underline">
                      {j.title || "Job"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {j.customer_name ?? "—"}
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {j.scheduled_date ? formatDate(j.scheduled_date) : "—"}
                  </TableCell>
                  {isStaff ? (
                    <TableCell className="text-muted-foreground">
                      {j.assigned_to
                        ? nameById.get(j.assigned_to) ?? "Assigned"
                        : "—"}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  );
}

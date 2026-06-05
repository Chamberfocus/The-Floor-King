import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Calendar, User, Trash2, Play, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { JobStatusBadge } from "@/components/job-status-badge";
import { getJob, listAssignableUsers } from "@/lib/data/jobs";
import { getProfileNames } from "@/lib/data/customers";
import { requireProfile } from "@/lib/auth";
import { lineTotal } from "@/lib/estimate-calc";
import { formatDate, formatMoney } from "@/lib/format";
import { JobForm } from "../job-form";
import { setJobStatus, deleteJob } from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = await getJob(id);
  return { title: job?.title ?? "Job" };
}

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const isStaff = profile.role === "admin" || profile.role === "office";

  const job = await getJob(id);
  if (!job) notFound();

  const users = isStaff ? await listAssignableUsers() : [];
  const names = job.assigned_to ? await getProfileNames([job.assigned_to]) : {};
  const assignedName = job.assigned_to ? names[job.assigned_to] : null;

  const siteParts = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to jobs
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {job.title || "Job"}
            </h1>
            <JobStatusBadge status={job.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {isStaff && job.customer ? (
              <Link
                href={`/customers/${job.customer_id}`}
                className="hover:underline"
              >
                {job.customer.full_name}
              </Link>
            ) : (
              job.customer?.full_name
            )}
          </p>
        </div>
        {/* Crew quick actions */}
        <div className="flex items-center gap-2">
          {job.status !== "in_progress" && job.status !== "completed" ? (
            <form action={setJobStatus}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="status" value="in_progress" />
              <Button type="submit" variant="outline">
                <Play className="size-4" /> Start job
              </Button>
            </form>
          ) : null}
          {job.status !== "completed" ? (
            <form action={setJobStatus}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="status" value="completed" />
              <Button type="submit">
                <Check className="size-4" /> Mark complete
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {/* Schedule / site summary */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <Calendar className="size-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Scheduled</div>
              <div className="font-medium">
                {job.scheduled_date ? formatDate(job.scheduled_date) : "Not set"}
                {job.scheduled_end
                  ? ` – ${formatDate(job.scheduled_end)}`
                  : ""}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <User className="size-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Crew</div>
              <div className="font-medium">{assignedName ?? "Unassigned"}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm">
            <MapPin className="size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Job site</div>
              <div className="font-medium">
                {siteParts.length ? siteParts.join(" · ") : "—"}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Work order scope */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Work order — scope</CardTitle>
        </CardHeader>
        <CardContent>
          {job.line_items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scope attached. Link this job to an approved estimate to pull in
              the rooms and materials.
            </p>
          ) : (
            <div className="divide-y text-sm">
              {job.line_items.map((l) => (
                <div
                  key={l.id}
                  className="flex items-start justify-between gap-4 py-2"
                >
                  <div>
                    <div className="font-medium">
                      {l.room ? `${l.room} — ` : ""}
                      {l.description || "Line item"}
                    </div>
                    {l.sqft ? (
                      <div className="text-xs text-muted-foreground">
                        {l.sqft} sq ft
                      </div>
                    ) : null}
                  </div>
                  {isStaff ? (
                    <div className="shrink-0 text-muted-foreground">
                      {formatMoney(lineTotal(l))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {job.notes ? (
            <div className="mt-4 rounded-md bg-muted p-3 text-sm">
              <div className="mb-1 font-medium">Notes for crew</div>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {job.notes}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Staff editing */}
      {isStaff ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Schedule &amp; details</CardTitle>
            </CardHeader>
            <CardContent>
              <JobForm job={job} users={users} />
            </CardContent>
          </Card>

          <div className="mt-4 flex items-center justify-between">
            {job.estimate_id ? (
              <Link
                href={`/estimates/${job.estimate_id}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                View source estimate
              </Link>
            ) : (
              <span />
            )}
            <form action={deleteJob}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="customer_id" value={job.customer_id} />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-3.5" /> Delete job
              </Button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

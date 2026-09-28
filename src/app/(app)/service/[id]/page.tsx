import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, MapPin, Phone } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getProfileNames } from "@/lib/data/customers";
import { getServiceCallback, listServiceAssignees } from "@/lib/data/ops-glue";
import { formatDate, formatDateTime } from "@/lib/format";
import { jobOperationsStatusLabel } from "@/lib/job-operations-status";
import {
  serviceReportedAge,
  serviceStatusLabel,
  serviceVisitLabel,
} from "@/lib/service-callback";
import { serviceQueueKindLabel, SERVICE_LIST_ROLES } from "@/lib/work-queues";
import type { JobStatus } from "@/lib/types";
import { ServiceRecordActions } from "../service-record-actions";
import { cancelServiceCallback } from "@/app/(app)/ops/actions";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Service issue" };
export const dynamic = "force-dynamic";

const EDIT_ROLES = ["admin", "office", "sales_manager", "salesman"] as const;

export default async function ServiceCallbackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (!SERVICE_LIST_ROLES.includes(profile.role)) redirect("/");
  const { id } = await params;
  const row = await getServiceCallback(id);
  if (!row) notFound();
  const canEdit = (EDIT_ROLES as readonly string[]).includes(profile.role);
  const [assignees, names] = await Promise.all([
    canEdit ? listServiceAssignees() : Promise.resolve([] as { id: string; name: string }[]),
    row.assigned_to
      ? getProfileNames([row.assigned_to])
      : Promise.resolve({} as Record<string, string>),
  ]);
  const assignedName = row.assigned_to ? names[row.assigned_to] ?? "Assigned" : "Unassigned";
  const age = serviceReportedAge(row.reported_at);
  const maps = row.place
    ? `https://maps.google.com/?q=${encodeURIComponent(row.place)}`
    : null;

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <Link
        href="/service"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Service
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {row.customer_name || "Service issue"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {serviceQueueKindLabel(row.category)}
            {age ? ` · ${age}` : ""}
          </p>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
          {serviceStatusLabel(row.status)}
        </span>
      </div>

      <dl className="mb-4 grid gap-3 rounded-lg border bg-card p-3 text-sm sm:grid-cols-2">
        <Fact label="Reported">
          {row.reported_at ? formatDate(row.reported_at) : "Not recorded"}
        </Fact>
        <Fact label={serviceVisitLabel({ status: row.status, followUpAt: row.follow_up_at })}>
          {row.follow_up_at ? formatDate(row.follow_up_at) : "None"}
        </Fact>
        <Fact label="Assigned">{assignedName}</Fact>
        <Fact label="Customer">
          <Link href={`/customers/${row.customer_id}`} className="text-primary hover:underline">
            {row.customer_name || "Open customer"}
          </Link>
          {row.customer_phone ? (
            <a href={`tel:${row.customer_phone}`} className="mt-1 flex min-h-11 items-center gap-1 text-primary">
              <Phone className="size-4" /> {row.customer_phone}
            </a>
          ) : null}
        </Fact>
        <Fact label="Job">
          {row.job_id ? (
            <Link href={`/jobs/${row.job_id}`} className="text-primary hover:underline">
              {row.job_title || "Open job"}
            </Link>
          ) : (
            "Not tied to a job"
          )}
        </Fact>
        <Fact label="Installation">
          {row.job_id
            ? jobOperationsStatusLabel((row.job_status as JobStatus) ?? "unscheduled")
            : "No installation on this issue"}
          {row.job_completed_at ? ` · completed ${formatDateTime(row.job_completed_at)}` : ""}
          {row.job_scheduled_date ? ` · install date ${formatDate(row.job_scheduled_date)}` : ""}
        </Fact>
        {row.place ? (
          <Fact label="Address">
            {maps ? (
              <a href={maps} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-primary">
                <MapPin className="size-4" /> {row.place}
              </a>
            ) : (
              row.place
            )}
          </Fact>
        ) : null}
      </dl>

      <section className="mb-4 rounded-lg border p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What was reported
        </h2>
        <p className="mt-1 whitespace-pre-wrap text-sm">{row.description || "No description."}</p>
      </section>

      <section className="mb-4 rounded-lg border p-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Resolution
        </h2>
        {row.status === "resolved" ? (
          <div className="mt-1 text-sm">
            <p className="whitespace-pre-wrap">{row.resolution_notes || "Resolved with no note."}</p>
            {row.completed_at ? (
              <p className="mt-1 text-muted-foreground">Resolved {formatDateTime(row.completed_at)}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not resolved.</p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Follow-up notes are not stored separately from this resolution. The original report above is left as entered.
        </p>
      </section>

      {row.job_id ? (
        <p className="mb-4 text-sm">
          <Link href={`/jobs/${row.job_id}`} className="text-primary hover:underline">
            Job photos and files
          </Link>
          <span className="text-muted-foreground"> stay on the job. This issue does not have its own file list.</span>
        </p>
      ) : null}

      {canEdit ? (
        <ServiceRecordActions
          callbackId={row.id}
          status={row.status}
          assignedTo={row.assigned_to}
          followUpAt={row.follow_up_at}
          assignees={assignees}
          canCancel={profile.role === "admin" || profile.role === "office"}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          You can review this issue. Scheduling and resolution are handled by the office.
        </p>
      )}

      {canEdit && (profile.role === "admin" || profile.role === "office") && row.status !== "resolved" && row.status !== "cancelled" ? (
        <form action={cancelServiceCallback} className="mt-4">
          <input type="hidden" name="callback_id" value={row.id} />
          <Button type="submit" variant="outline" className="min-h-11">
            Cancel issue
          </Button>
        </form>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

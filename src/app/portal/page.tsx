import type { Metadata } from "next";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth";
import {
  listPortalCompletionDays,
  listPortalEstimates,
  listPortalInstallHolds,
  listPortalInstallerNames,
  listPortalJobs,
} from "@/lib/data/portal-commercial";
import { listPortalProjects } from "@/lib/data/portal-projects";
import { listInvoicesForCustomer, invoiceDisplayTotals } from "@/lib/data/invoices";
import { listCustomerCheckouts } from "@/lib/data/samples";
import { formatDate, formatMoney, to12 } from "@/lib/format";
import {
  getInstallAvailability,
  listInstallPreferences,
} from "@/lib/data/install-availability";
import { InstallPreferencePicker } from "./install-preference-picker";
import { portalInstallScheduleCopy } from "@/lib/install-closeout";
import { customerToldInstallIsLocked, portalInstallHoldCopy } from "@/lib/install-hold";
import { PortalProjectCard } from "./project-card";
import type { JobStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Your project" };

export default async function PortalHome() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] ?? "there";

  if (!profile.customer_id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Your account isn&apos;t linked to your project yet. Please contact us
          and we&apos;ll get you set up.
        </CardContent>
      </Card>
    );
  }

  const customerId = profile.customer_id;
  const [projects, estimates, jobs, invoices, sampleCheckouts] = await Promise.all([
    listPortalProjects(customerId),
    listPortalEstimates(customerId),
    listPortalJobs(customerId),
    listInvoicesForCustomer(customerId),
    listCustomerCheckouts(customerId),
  ]);
  const samplesOut = sampleCheckouts.filter((c) => c.status === "out");
  const needsEstimate = estimates.filter(
    (e) => e.status === "sent" || e.status === "changes_requested" || e.discussion_requested_at,
  );
  const openInvoices = invoices
    .map((inv) => ({ inv, totals: invoiceDisplayTotals(inv) }))
    .filter((row) => row.totals.balance > 0);

  const activeJobs = jobs.filter((j) => j.status !== "completed" && j.status !== "cancelled");
  const schedByJob = new Map<
    string,
    { days: number; availableStarts: string[]; existing: string[] }
  >();
  for (const j of activeJobs) {
    if (j.scheduled_date) continue;
    const avail = await getInstallAvailability(j.id);
    const existing = (await listInstallPreferences(j.id)).map((p) => p.preferred_date);
    schedByJob.set(j.id, {
      days: avail?.days ?? 0,
      availableStarts: avail?.availableStarts ?? [],
      existing,
    });
  }
  const installerNameByJobId = await listPortalInstallerNames(customerId, activeJobs);
  const installHolds = await listPortalInstallHolds(
    customerId,
    jobs.map((j) => j.id),
  );
  const completedIds = jobs.filter((j) => j.status === "completed").map((j) => j.id);
  const completedOnByJobId = await listPortalCompletionDays(customerId, completedIds);
  const jobById = new Map(jobs.map((job) => [job.id, job]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            Welcome, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">Where your project stands.</p>
        </div>
        <Link href="/portal/order" className={buttonVariants({ variant: "outline" })}>
          <ShoppingBag className="size-4" /> Place an order
        </Link>
      </div>

      {needsEstimate.length || openInvoices.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Waiting on you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {needsEstimate.map((e) => (
              <Link
                key={e.id}
                href={`/portal/estimates/${e.id}`}
                className="block rounded-md border px-3 py-2 font-medium hover:border-primary"
              >
                {e.discussion_requested_at
                  ? `You asked to discuss ${e.title || "your estimate"}`
                  : `Review ${e.title || "your estimate"}`}
              </Link>
            ))}
            {openInvoices.map(({ inv, totals }) => (
              <Link
                key={inv.id}
                href={`/portal/invoices/${inv.id}`}
                className="block rounded-md border px-3 py-2 font-medium hover:border-primary"
              >
                {inv.number || "Invoice"} · {formatMoney(totals.balance)} due
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {projects.map((project) => {
          const job = project.kind === "job" ? jobById.get(project.id) : undefined;
          return (
            <PortalProjectCard key={`${project.kind}-${project.id}`} project={project}>
              {job ? (
                <ProjectSchedule
                  job={job}
                  sched={schedByJob.get(job.id)}
                  installer={installerNameByJobId.get(job.id) ?? null}
                  hold={installHolds.get(job.id)}
                  completedOn={completedOnByJobId.get(job.id) ?? null}
                />
              ) : null}
            </PortalProjectCard>
          );
        })}
      </div>

      {jobs.some(
        (job) =>
          job.status === "cancelled" &&
          !projects.some((project) => project.kind === "job" && project.id === job.id),
      ) ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          {jobs
            .filter(
              (job) =>
                job.status === "cancelled" &&
                !projects.some((project) => project.kind === "job" && project.id === job.id),
            )
            .map((job) => (
              <p key={job.id}>{job.title || "Installation"} is cancelled.</p>
            ))}
        </div>
      ) : null}

      {samplesOut.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Samples to return</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {samplesOut.map((c) => (
              <div key={c.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">
                  Please return by{" "}
                  {new Date(`${c.due_date}T12:00:00`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {c.items.map((i) => (
                    <li key={i.id}>
                      {i.qty > 1 ? `${i.qty}× ` : ""}
                      {i.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

    </div>
  );
}

function ProjectSchedule({
  job,
  sched,
  installer,
  hold,
  completedOn,
}: {
  job: {
    id: string;
    status: JobStatus;
    scheduled_date: string | null;
    arrival_window?: string | null;
  };
  sched?: { days: number; availableStarts: string[]; existing: string[] };
  installer: string | null;
  hold: string | null | undefined;
  completedOn: string | null;
}) {
  const arrivalLabel = job.arrival_window
    ? job.arrival_window
        .split("-")
        .map((t) => to12(t.trim()))
        .join("–")
    : null;
  const dateLabel = job.scheduled_date ? formatDate(job.scheduled_date) : null;
  const locked = customerToldInstallIsLocked(hold, !!job.scheduled_date);
  const scheduleCopy =
    !locked && dateLabel && job.status !== "completed" && job.status !== "cancelled"
      ? portalInstallHoldCopy(dateLabel)
      : job.status === "completed" || job.status === "cancelled" || locked
        ? portalInstallScheduleCopy({
            status: job.status,
            scheduledDateLabel: dateLabel,
            windowLabel: locked ? arrivalLabel : null,
            installerName: locked ? installer : null,
            completedOnLabel: completedOn,
          })
        : null;

  return (
    <div className="mt-4">
      {scheduleCopy ? (
        <div
          className={
            locked
              ? "rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20"
              : "rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/20"
          }
        >
          <div
            className={
              locked ? "font-semibold text-emerald-800 dark:text-emerald-300" : "font-semibold"
            }
          >
            {scheduleCopy.title}
          </div>
          {scheduleCopy.detail ? <div className="mt-0.5">{scheduleCopy.detail}</div> : null}
        </div>
      ) : sched ? (
        <InstallPreferencePicker
          jobId={job.id}
          days={sched.days}
          availableStarts={sched.availableStarts}
          existing={sched.existing}
        />
      ) : (
        <p className="text-sm text-muted-foreground">To be scheduled.</p>
      )}
    </div>
  );
}

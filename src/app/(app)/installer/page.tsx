import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Star, Wallet, MapPin, CalendarDays, ClipboardCheck, Camera, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInstallerHome } from "@/lib/data/installer";
import {
  InstallerCalendar,
  type CalEvent,
} from "../install-scheduler/installer-calendar";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JobStatusBadge } from "@/components/job-status-badge";
import { InstallerCollect } from "../jobs/[id]/installer-collect";
import { SatisfactionForm } from "../jobs/[id]/satisfaction-form";
import { JobPhotos } from "../jobs/[id]/job-photos";
import { JobScopeView } from "@/components/job-scope-view";
import { FlowPositionBadge } from "@/components/flow-position-badge";
import { listWorkflowStages } from "@/lib/data/workflow";
import { ClipboardList } from "lucide-react";
import { getJobProgress } from "@/lib/job-progress";
import { JobStepPopup } from "@/components/job-step-popup";
import { listMyAvailability } from "@/lib/data/crew-availability";
import { MyAvailability } from "./my-availability";

export const metadata: Metadata = { title: "My work" };
export const dynamic = "force-dynamic";

const RATING_KEY = [
  { n: 5, label: "Excellent" },
  { n: 4, label: "Good" },
  { n: 3, label: "Okay" },
  { n: 2, label: "Poor" },
  { n: 1, label: "Bad" },
];

function Stars({ n, size = "size-4" }: { n: number; size?: string }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(size, i <= Math.round(n) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40")}
        />
      ))}
    </span>
  );
}

export default async function InstallerHomePage() {
  const profile = await requireProfile();
  // Installer home is for the field crew; staff have their own boards.
  if (!["crew", "admin", "office"].includes(profile.role)) redirect("/");

  const settings = await getBusinessSettings();
  const home = await getInstallerHome(profile.id, settings.installer_collects_balance);
  const flowStages = await listWorkflowStages();
  const myAvailability = await listMyAvailability(profile.id);
  const active = home.jobs.filter((j) => j.job.status !== "completed");
  const doneCount = home.jobs.length - active.length;

  // My install calendar — only the installs assigned to me (RLS enforces this).
  const since = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 120);
    return d.toISOString().slice(0, 10);
  })();
  const supabase = await createClient();
  const { data: myRows } = await supabase
    .from("jobs")
    .select(
      "id, title, customer_id, scheduled_date, scheduled_end, arrival_window, site_city, status, customer:customers(full_name)",
    )
    .eq("assigned_to", profile.id)
    .not("scheduled_date", "is", null)
    .gte("scheduled_date", since)
    .or("delivery_type.is.null,delivery_type.neq.cash_carry")
    .order("scheduled_date", { ascending: true });
  const myEvents: CalEvent[] = ((myRows ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: string;
      title: string | null;
      customer_id: string | null;
      scheduled_date: string;
      scheduled_end: string | null;
      arrival_window: string | null;
      site_city: string | null;
      status: string | null;
      customer?: { full_name: string | null }[] | { full_name: string | null } | null;
    };
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    return {
      id: r.id,
      name: cust?.full_name ?? r.title ?? "Install",
      customerId: r.customer_id,
      date: r.scheduled_date,
      endDate: r.scheduled_end ?? null,
      window: r.arrival_window ?? null,
      resourceId: profile.id,
      resourceName: "You",
      city: r.site_city ?? null,
      status: r.status ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-16">
      <JobStepPopup
        jobs={active.map(({ job }) => ({
          ...getJobProgress(job),
          title: job.customer_name || job.title,
        }))}
      />
      <PageHeader title={`Hi, ${profile.full_name?.split(" ")[0] || "there"}`} description="Your jobs, pay, and sign-offs — all in one place." />

      {/* My install calendar — my assigned installs only. */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
          <CalendarDays className="size-4 text-primary" /> My install calendar
        </h2>
        <InstallerCalendar events={myEvents} resources={[]} hideFilter canEdit linkTo="job" />
      </section>

      {/* Availability — crew tell the office when they can't be scheduled. */}
      <section>
        <MyAvailability blocks={myAvailability} />
      </section>

      {/* Pay + ratings summary */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="size-4 text-primary" /> My pay
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">Unpaid</span>
              <span className="text-2xl font-bold tabular-nums text-emerald-600">{formatMoney(home.pay.unpaid)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm text-muted-foreground">
              <span>Paid to date</span>
              <span className="tabular-nums">{formatMoney(home.pay.paid)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm text-muted-foreground">
              <span>Earned (total)</span>
              <span className="tabular-nums">{formatMoney(home.pay.earned)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="size-4 text-amber-400" /> My ratings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {home.ratings.count ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums">{home.ratings.avg}</span>
                  <Stars n={home.ratings.avg} />
                  <span className="text-sm text-muted-foreground">({home.ratings.count})</span>
                </div>
                {home.ratings.recent.slice(0, 2).map((r, i) => (
                  <div key={i} className="text-xs text-muted-foreground">
                    {r.rating ? <Stars n={r.rating} size="size-3" /> : null}{" "}
                    {r.comments ? `“${r.comments}”` : r.job}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No customer ratings yet.</p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 border-t pt-2 text-[11px] text-muted-foreground">
              {RATING_KEY.map((k) => (
                <span key={k.n}>{k.n}★ {k.label}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* My jobs */}
      <div data-tour="my-work">
        <h2 className="mb-2 text-lg font-bold">My jobs</h2>
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No active jobs assigned to you right now.
          </div>
        ) : (
          <div className="space-y-3">
            {active.map(({ job, balance, hasInvoice, collectsBalance, satisfaction, photos, scope, customerStageId }) => {
              const site = [job.site_street, job.site_city, job.site_state].filter(Boolean).join(", ");
              const canCollect = collectsBalance && hasInvoice && balance > 0;
              return (
                <Card key={job.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{job.customer_name || job.title || "Job"}</CardTitle>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="size-3" />
                            {job.scheduled_date ? formatDate(job.scheduled_date) : "Not scheduled"}
                            {job.arrival_window ? ` · ${job.arrival_window}` : ""}
                          </span>
                          {site ? (
                            <a
                              href={`https://maps.google.com/?q=${encodeURIComponent(site)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                            >
                              <MapPin className="size-3" /> {job.site_city || "Map"}
                            </a>
                          ) : null}
                        </div>
                      </div>
                      <JobStatusBadge status={job.status} />
                    </div>
                    <div className="mt-1">
                      <FlowPositionBadge
                        stage={flowStages.find((s) => s.id === customerStageId) ?? null}
                        stages={flowStages}
                      />
                    </div>
                    <Link href={`/jobs/${job.id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      Open work order <ChevronRight className="size-3" />
                    </Link>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* The INSTALLATION work order — what to do, room by room. */}
                    <details className="group" open>
                      <summary className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15">
                        <ClipboardList className="size-4" />
                        Installation work order
                        <span className="ml-auto text-xs font-normal text-muted-foreground">tap to collapse</span>
                      </summary>
                      <div className="pt-3">
                        {/* Installers never see estimate/job prices. */}
                        <JobScopeView scope={scope} showPrices={false} />
                      </div>
                    </details>

                    {canCollect ? (
                      <div className="[&>*]:mb-0">
                        <InstallerCollect jobId={job.id} hasInvoice={hasInvoice} balance={balance} />
                      </div>
                    ) : null}

                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
                        <ClipboardCheck className={cn("size-4", satisfaction ? "text-emerald-600" : "text-primary")} />
                        Customer sign-off
                        {satisfaction ? <span className="ml-auto text-xs font-normal text-emerald-600">Signed ✓</span> : <span className="ml-auto text-xs font-normal text-muted-foreground">Not signed</span>}
                      </summary>
                      <div className="pt-3">
                        <SatisfactionForm jobId={job.id} existing={satisfaction} />
                      </div>
                    </details>

                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
                        <Camera className="size-4 text-primary" />
                        Completed photos
                        <span className="ml-auto text-xs font-normal text-muted-foreground">{photos.length || "None"}</span>
                      </summary>
                      <div className="pt-3">
                        <JobPhotos jobId={job.id} photos={photos} />
                      </div>
                    </details>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {doneCount ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">{doneCount} completed job{doneCount === 1 ? "" : "s"} not shown.</p>
        ) : null}
      </div>
    </div>
  );
}

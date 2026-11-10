import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Star,
  Wallet,
  MapPin,
  CalendarDays,
  ClipboardCheck,
  Camera,
  ChevronRight,
  ClipboardList,
  Phone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { showOnActiveInstallCalendar } from "@/lib/customer-operational";
import { getInstallerHome } from "@/lib/data/installer";
import {
  InstallerCalendar,
  type CalEvent,
} from "../install-scheduler/installer-calendar";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { JobStatusBadge } from "@/components/job-status-badge";
import { jobOperationsStatusLabel } from "@/lib/job-operations-status";
import { InstallerCollect } from "../jobs/[id]/installer-collect";
import { SatisfactionForm } from "../jobs/[id]/satisfaction-form";
import { JobPhotos } from "../jobs/[id]/job-photos";
import { JobScopeView } from "@/components/job-scope-view";
import { FlowPositionBadge } from "@/components/flow-position-badge";
import { listWorkflowStages } from "@/lib/data/workflow";
import { getJobProgress } from "@/lib/job-progress";
import { JobStepPopup } from "@/components/job-step-popup";
import { listMyAvailability } from "@/lib/data/crew-availability";
import { MyAvailability } from "./my-availability";
import { InstallerIssueForm } from "./installer-issue-form";
import { InstallerUpdateForm } from "./installer-update-form";
import { JobExtraForm } from "../jobs/[id]/job-extra-form";
import { listJobExtras } from "@/lib/data/job-ticket";
import { JobInstallActions } from "../jobs/[id]/job-install-actions";
import {
  customerSignOffRecorded,
  installationStatusFact,
} from "@/lib/install-closeout";
import { loadSignoffPriceAlerts } from "@/lib/data/signoff-sheet";
import { signoffPriceAlert, type SignoffPriceAlert } from "@/lib/signoff-sheet";
import { installerFocusJob, installerHubTab, type InstallerHubTab } from "@/lib/installer-hub";
import { shopTodayYmd } from "@/lib/job-snapshot";
import { JobBoardList } from "@/components/job-board-list";
import { getMyApplicationJobIds, listOpenJobs } from "@/lib/data/jobs";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "My work" };
export const dynamic = "force-dynamic";

const RATING_KEY = [
  { n: 5, label: "Excellent" },
  { n: 4, label: "Good" },
  { n: 3, label: "Okay" },
  { n: 2, label: "Poor" },
  { n: 1, label: "Bad" },
];

const HUB_TABS: { id: InstallerHubTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "jobs", label: "My jobs" },
  { id: "board", label: "Job board" },
  { id: "off", label: "Days off" },
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

async function loadMyInstallCalendar(profileId: string) {
  const since = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 120);
    return d.toISOString().slice(0, 10);
  })();
  const supabase = await createClient();
  const calendarSelect =
    "id, title, customer_id, scheduled_date, scheduled_end, arrival_window, site_city, status, install_hold, customer:customers(full_name, cancelled_at)";
  const { data, error } = await supabase
    .from("jobs")
    .select(calendarSelect)
    .eq("assigned_to", profileId)
    .not("scheduled_date", "is", null)
    .gte("scheduled_date", since)
    .or("delivery_type.is.null,delivery_type.neq.cash_carry")
    .order("scheduled_date", { ascending: true });
  if (!error) return data;
  const fallback = await supabase
    .from("jobs")
    .select(
      "id, title, customer_id, scheduled_date, scheduled_end, arrival_window, site_city, status, customer:customers(full_name, cancelled_at)",
    )
    .eq("assigned_to", profileId)
    .not("scheduled_date", "is", null)
    .gte("scheduled_date", since)
    .or("delivery_type.is.null,delivery_type.neq.cash_carry")
    .order("scheduled_date", { ascending: true });
  return fallback.data;
}

export default async function InstallerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; job?: string }>;
}) {
  const profile = await requireProfile();
  if (!["crew", "admin", "office"].includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const tab = installerHubTab(sp.tab);

  const settingsPromise = getBusinessSettings();
  const [, flowStages, myAvailability, myRows, home] = await Promise.all([
    settingsPromise,
    listWorkflowStages(),
    listMyAvailability(profile.id),
    loadMyInstallCalendar(profile.id),
    settingsPromise.then((settings) =>
      getInstallerHome(profile.id, settings.installer_collects_balance),
    ),
  ]);
  const signedOff = (row: (typeof home.jobs)[number]) =>
    customerSignOffRecorded({
      signature: row.satisfaction?.signature,
      signedName: row.satisfaction?.signed_name,
    });
  // A finished job stays on the phone until the customer signs. Signed
  // completed jobs stay off this list.
  const awaitingSignoff = home.jobs.filter(
    (row) => row.job.status === "completed" && !signedOff(row),
  );
  const openJobs = home.jobs.filter((row) => row.job.status !== "completed");
  const visible = [...awaitingSignoff, ...openJobs];
  const openId = visible.some((row) => row.job.id === sp.job) ? sp.job : null;
  const [priceAlerts, extraRows, board] = await Promise.all([
    tab === "jobs" && openId ? loadSignoffPriceAlerts([openId]) : Promise.resolve(new Map()),
    tab === "jobs" && openId
      ? listJobExtras(openId).then((rows) => [[openId, rows] as const])
      : Promise.resolve([] as (readonly [string, Awaited<ReturnType<typeof listJobExtras>>])[]),
    tab === "board"
      ? Promise.all([
          listOpenJobs({
            id: profile.id,
            isStaff: profile.role === "admin" || profile.role === "office",
          }),
          getMyApplicationJobIds(),
        ])
      : Promise.resolve(null),
  ]);
  const noPriceAlert: SignoffPriceAlert = signoffPriceAlert({ invoices: [], extras: [] });
  const extrasByJob = new Map(extraRows);
  const doneCount = home.jobs.length - visible.length;
  const today = shopTodayYmd();
  const focus = installerFocusJob(
    visible.map(({ job }) => ({
      id: job.id,
      status: job.status,
      scheduled_date: job.scheduled_date,
    })),
    today,
  );
  const focusRow = visible.find((row) => row.job.id === focus?.id) ?? null;

  const myEvents: CalEvent[] = ((myRows ?? []) as unknown[]).flatMap((row) => {
    const r = row as {
      id: string;
      title: string | null;
      customer_id: string | null;
      scheduled_date: string;
      scheduled_end: string | null;
      arrival_window: string | null;
      site_city: string | null;
      status: string | null;
      install_hold?: string | null;
      customer?:
        | { full_name: string | null; cancelled_at?: string | null }
        | { full_name: string | null; cancelled_at?: string | null }[]
        | null;
    };
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (
      !showOnActiveInstallCalendar({
        status: r.status,
        customerCancelledAt: cust?.cancelled_at,
      })
    ) {
      return [];
    }
    return [{
      id: r.id,
      name: `${cust?.full_name ?? r.title ?? "Install"}${r.install_hold === "requested" ? " (requested)" : ""}`,
      customerId: r.customer_id,
      date: r.scheduled_date,
      endDate: r.scheduled_end ?? null,
      window: r.arrival_window ?? null,
      resourceId: profile.id,
      resourceName: "You",
      city: r.site_city ?? null,
      status: r.status ?? null,
    }];
  });
  const upcoming = myEvents.filter((event) => event.date >= today).slice(0, 6);

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8" data-tour="my-work">
      <JobStepPopup
        jobs={visible.map(({ job }) => ({
          ...getJobProgress(job),
          title: job.customer_name || job.title,
        }))}
      />
      <PageHeader
        title={`Hi, ${profile.full_name?.split(" ")[0] || "there"}`}
        description="Your jobs, the board, days off, and the work on site."
      />

      <nav className="sticky top-0 z-20 -mx-1 flex gap-2 overflow-x-auto bg-background/95 py-2 backdrop-blur">
        {HUB_TABS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "today" ? "/installer" : `/installer?tab=${item.id}`}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold",
              tab === item.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "today" ? (
        <section className="space-y-4">
          {focusRow ? (
            <FocusCard row={focusRow} />
          ) : (
            <Card>
              <CardContent className="space-y-3 pt-6 text-sm">
                <p>No job is on your phone right now.</p>
                <Link href="/installer?tab=board" className={buttonVariants({ className: "min-h-11 w-full" })}>
                  Claim a job from the board
                </Link>
              </CardContent>
            </Card>
          )}

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

          <section>
            <h2 className="mb-2 text-base font-semibold">Coming up</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing dated after today.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {upcoming.map((event) => (
                  <li key={event.id}>
                    <Link href={`/installer?tab=jobs&job=${event.id}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{event.name}</span>
                        <span className="text-muted-foreground">
                          {formatDate(event.date)}
                          {event.city ? ` · ${event.city}` : ""}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer text-sm font-medium text-primary">Month calendar</summary>
              <div className="pt-3">
                <InstallerCalendar events={myEvents} resources={[]} hideFilter canEdit linkTo="job" />
              </div>
            </details>
          </section>
        </section>
      ) : null}

      {tab === "jobs" ? (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">My jobs</h2>
          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No active jobs assigned to you right now.
              <div className="mt-3">
                <Link href="/installer?tab=board" className="font-medium text-primary">Claim one from the job board</Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[...visible]
                .sort((a, b) => {
                  if (a.job.id === openId) return -1;
                  if (b.job.id === openId) return 1;
                  return 0;
                })
                .map((row) =>
                row.job.id === openId ? (
                  <JobWork
                    key={row.job.id}
                    row={row}
                    profileId={profile.id}
                    flowStages={flowStages}
                    priceAlert={priceAlerts.get(row.job.id) ?? noPriceAlert}
                    extras={extrasByJob.get(row.job.id) ?? []}
                  />
                ) : (
                  <JobSummary key={row.job.id} row={row} />
                ),
              )}
            </div>
          )}
          {doneCount ? (
            <p className="text-center text-xs text-muted-foreground">
              {doneCount} completed job{doneCount === 1 ? "" : "s"} not shown.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === "board" && board ? (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Tap Claim this job. The office approves it, then it shows up in My jobs.
          </p>
          <JobBoardList
            jobs={board[0]}
            appliedIds={board[1]}
            isStaff={profile.role === "admin" || profile.role === "office"}
          />
        </section>
      ) : null}

      {tab === "off" ? <MyAvailability blocks={myAvailability} /> : null}
    </div>
  );
}

function FocusCard({
  row,
}: {
  row: Awaited<ReturnType<typeof getInstallerHome>>["jobs"][number];
}) {
  const { job, balance, hasInvoice, collectsBalance, satisfaction, photos } = row;
  const site = [job.site_street, job.site_city, job.site_state].filter(Boolean).join(", ");
  const canCollect = collectsBalance && hasInvoice && balance > 0;
  const signed = customerSignOffRecorded({
    signature: satisfaction?.signature,
    signedName: satisfaction?.signed_name,
  });
  return (
    <Card>
      <CardHeader className="pb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Next job</p>
        <CardTitle className="text-xl">{job.customer_name || job.title || "Job"}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {job.scheduled_date ? formatDate(job.scheduled_date) : "Not scheduled"}
          {job.arrival_window ? ` · ${job.arrival_window}` : ""}
          {" · "}
          {jobOperationsStatusLabel(job.status)}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {job.customer_phone ? (
            <a href={`tel:${job.customer_phone}`} className={buttonVariants({ className: "min-h-12" })}>
              <Phone className="size-4" /> Call
            </a>
          ) : null}
          {site ? (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(site)}`}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", className: "min-h-12" })}
            >
              <MapPin className="size-4" /> Map
            </a>
          ) : null}
        </div>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>Sign-off: {signed ? "Recorded" : "Not recorded"}</li>
          <li>Photos: {photos.length ? `${photos.length} uploaded` : "None uploaded"}</li>
          {canCollect ? <li>Collect on site: {formatMoney(balance)}</li> : null}
        </ul>
        <Link
          href={`/installer?tab=jobs&job=${job.id}`}
          className={buttonVariants({ className: "min-h-12 w-full" })}
        >
          Open work order
        </Link>
      </CardContent>
    </Card>
  );
}

function JobSummary({
  row,
}: {
  row: Awaited<ReturnType<typeof getInstallerHome>>["jobs"][number];
}) {
  const { job } = row;
  return (
    <Link
      href={`/installer?tab=jobs&job=${job.id}`}
      className="flex min-h-16 items-center justify-between gap-3 rounded-xl border bg-card px-3 py-3"
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold">{job.customer_name || job.title || "Job"}</span>
        <span className="text-sm text-muted-foreground">
          {job.scheduled_date ? formatDate(job.scheduled_date) : "Not scheduled"}
          {" · "}
          {jobOperationsStatusLabel(job.status)}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function JobWork({
  row,
  profileId,
  flowStages,
  priceAlert,
  extras,
}: {
  row: Awaited<ReturnType<typeof getInstallerHome>>["jobs"][number];
  profileId: string;
  flowStages: Awaited<ReturnType<typeof listWorkflowStages>>;
  priceAlert: SignoffPriceAlert;
  extras: Awaited<ReturnType<typeof listJobExtras>>;
}) {
  const { job, balance, hasInvoice, collectsBalance, satisfaction, photos, scope, customerStageId } = row;
  const site = [job.site_street, job.site_city, job.site_state].filter(Boolean).join(", ");
  const canCollect = collectsBalance && hasInvoice && balance > 0;
  const signed = customerSignOffRecorded({
    signature: satisfaction?.signature,
    signedName: satisfaction?.signed_name,
  });
  const sheetOpen = job.status === "completed" || job.status === "in_progress";
  const sheet = (
    <SatisfactionForm
      jobId={job.id}
      existing={satisfaction}
      customerName={job.customer_name || job.title || "the customer"}
      balance={balance}
      alert={priceAlert}
      canCollect={canCollect}
    />
  );
  return (
    <Card className="overflow-hidden">
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
              {job.customer_phone ? (
                <a href={`tel:${job.customer_phone}`} className="inline-flex min-h-8 items-center gap-1 font-medium text-primary">
                  <Phone className="size-3" /> {job.customer_phone}
                </a>
              ) : null}
            </div>
          </div>
          <JobStatusBadge status={job.status} label={jobOperationsStatusLabel(job.status)} />
        </div>
        <div className="mt-1">
          <FlowPositionBadge
            stage={flowStages.find((s) => s.id === customerStageId) ?? null}
            stages={flowStages}
          />
        </div>
        <Link href={`/jobs/${job.id}`} className="mt-1 inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary">
          Open work order <ChevronRight className="size-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Installation</dt>
            <dd className="font-medium">{installationStatusFact(job.status)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Customer sign-off</dt>
            <dd className="font-medium">{signed ? "Recorded" : "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Completion photos</dt>
            <dd className="font-medium">{photos.length ? `${photos.length} uploaded` : "None uploaded"}</dd>
          </div>
          {canCollect ? (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Collect on site</dt>
              <dd className="font-medium">{formatMoney(balance)}</dd>
            </div>
          ) : null}
        </dl>
        {job.assigned_to === profileId ? (
          <JobInstallActions
            jobId={job.id}
            status={job.status}
            title={job.customer_name || job.title || "this job"}
          />
        ) : null}
        {job.status === "completed" ? sheet : null}
        <details className="group" open={job.status !== "completed"}>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm font-semibold text-primary hover:bg-primary/15">
            <ClipboardList className="size-4" />
            Installation work order
            <span className="ml-auto text-xs font-normal text-muted-foreground">tap to collapse</span>
          </summary>
          <div className="pt-3">
            <JobScopeView scope={scope} showPrices={false} />
          </div>
        </details>
        {job.status === "in_progress" ? sheet : null}
        {canCollect && satisfaction?.payment_choice !== "contact_store" ? (
          <div className="[&>*]:mb-0">
            <InstallerCollect jobId={job.id} hasInvoice={hasInvoice} balance={balance} />
          </div>
        ) : null}
        {sheetOpen ? null : (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
              <ClipboardCheck className={cn("size-4", signed ? "text-emerald-600" : "text-primary")} />
              Customer sign-off
              {signed ? (
                <span className="ml-auto text-xs font-normal text-emerald-600">Signed ✓</span>
              ) : (
                <span className="ml-auto text-xs font-normal text-muted-foreground">Not signed</span>
              )}
            </summary>
            <div className="pt-3">{sheet}</div>
          </details>
        )}
        <details className="group" open>
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
            <Camera className="size-4 text-primary" />
            Completed photos
            <span className="ml-auto text-xs font-normal text-muted-foreground">{photos.length || "None"}</span>
          </summary>
          <div className="pt-3">
            <JobPhotos jobId={job.id} photos={photos} />
          </div>
        </details>
        {job.assigned_to === profileId ? (
          <details className="group">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium hover:bg-muted">
              Extra work the customer signs
            </summary>
            <div className="pt-3">
              <JobExtraForm jobId={job.id} extras={extras} />
            </div>
          </details>
        ) : null}
        <InstallerUpdateForm jobId={job.id} />
        <InstallerIssueForm jobId={job.id} />
      </CardContent>
    </Card>
  );
}

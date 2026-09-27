import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { InstallSchedule } from "../customers/[id]/install-schedule";
import { buildInstallScheduleProps } from "@/lib/data/install-schedule";
import { listAssignableUsers, listSchedulerQueue } from "@/lib/data/jobs";
import { WorkQueueBar, WorkQueuePager } from "@/components/work-queue-bar";
import { parseListPage, resultCountLabel } from "@/lib/work-queues";
import { QUEUE_LIST_UNAVAILABLE, queueFailureMessage } from "@/lib/ops-scale";
import { listInstallCrews } from "@/lib/data/install-crews";
import { INSTALL_ROLES } from "@/lib/types";
import type { CalEvent, CalResource } from "./installer-calendar";
import { InstallerGrid } from "./installer-grid";
import { SchedulerTabs, ClientScheduleRow } from "./scheduler-ui";
import { listCrewAvailabilityForOffice } from "@/lib/data/crew-availability";
import { CrewAvailabilityBoard } from "./crew-availability-board";

export const metadata: Metadata = { title: "Install Scheduler" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function InstallSchedulerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; booked?: string }>;
}) {
  const profile = await requireProfile();
  if (!["admin", "office", "scheduler"].includes(profile.role)) redirect("/");

  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const supabase = await createClient();
  const empty: Awaited<ReturnType<typeof listSchedulerQueue>> = {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 40,
  };
  let listError: string | null = null;
  let ready = empty;
  let booked = empty;
  try {
    [ready, booked] = await Promise.all([
      listSchedulerQueue({ section: "ready", search: q, page: parseListPage(sp.page) }),
      listSchedulerQueue({ section: "booked", search: q, page: parseListPage(sp.booked) }),
    ]);
  } catch (error) {
    listError = queueFailureMessage(error);
  }

  // ---- Install calendar: every booked install (recent past + all future),
  // with its installer/crew, for the day/week/month calendar. ----
  const since = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 120);
    return d.toISOString().slice(0, 10);
  })();
  const [{ data: calRows }, installerUsers, crews] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, title, customer_id, scheduled_date, scheduled_end, arrival_window, assigned_to, assigned_crew_id, site_city, status, customer:customers(full_name)",
      )
      .not("scheduled_date", "is", null)
      .gte("scheduled_date", since)
      .or("delivery_type.is.null,delivery_type.neq.cash_carry")
      .order("scheduled_date", { ascending: true }),
    listAssignableUsers(),
    listInstallCrews({ activeOnly: false }),
  ]);
  const userName = new Map(installerUsers.map((u) => [u.id, u.name] as const));
  const crewName = new Map(
    crews.map(
      (c) =>
        [c.id, `${c.name}${c.kind === "subcontractor" ? " (sub)" : ""}`] as const,
    ),
  );
  const calEvents: CalEvent[] = ((calRows ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: string;
      title: string | null;
      customer_id: string | null;
      scheduled_date: string;
      scheduled_end: string | null;
      arrival_window: string | null;
      assigned_to: string | null;
      assigned_crew_id: string | null;
      site_city: string | null;
      status: string | null;
      customer?: { full_name: string | null }[] | { full_name: string | null } | null;
    };
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    const resourceId = r.assigned_to
      ? r.assigned_to
      : r.assigned_crew_id
        ? `crew:${r.assigned_crew_id}`
        : "unassigned";
    const resourceName = r.assigned_to
      ? (userName.get(r.assigned_to) ?? "Installer")
      : r.assigned_crew_id
        ? (crewName.get(r.assigned_crew_id) ?? "Crew")
        : "Unassigned";
    return {
      id: r.id,
      name: cust?.full_name ?? r.title ?? "Job",
      customerId: r.customer_id,
      date: r.scheduled_date,
      endDate: r.scheduled_end ?? null,
      window: r.arrival_window ?? null,
      resourceId,
      resourceName,
      city: r.site_city ?? null,
      status: r.status ?? null,
    };
  });
  const installRoles = INSTALL_ROLES as unknown as string[];
  const installerList = installerUsers.filter((u) => installRoles.includes(u.role));
  // A team installer (login) auto-gets a mirror "employee" crew for payouts —
  // drop those from the grid so each person appears ONCE (by name).
  const installerNames = new Set(installerList.map((u) => u.name.trim().toLowerCase()));
  const calResources: CalResource[] = [
    ...installerList.map((u) => ({ id: u.id, name: u.name })),
    ...crews
      .filter((c) => !installerNames.has((c.name || "").trim().toLowerCase()))
      .map((c) => ({
        id: `crew:${c.id}`,
        name: `${c.name}${c.kind === "subcontractor" ? " (sub)" : ""}`,
      })),
  ];
  if (calEvents.some((e) => e.resourceId === "unassigned"))
    calResources.push({ id: "unassigned", name: "Unassigned" });

  // Only the "needs a date" jobs render the full scheduler (that's the work);
  // upcoming installs are quick links so the page stays fast.
  const needsProps = await Promise.all(
    ready.rows.map(async (j) => ({
      j,
      props: j.customer_id ? await buildInstallScheduleProps(j.id, j.customer_id) : null,
    })),
  );

  const crewAvailability = await listCrewAvailabilityForOffice();

  const name = (j: { customer_name: string | null; title: string | null }) =>
    j.customer_name ?? j.title ?? "Job";
  const schedulerHref = (next: { page?: number; booked?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const page = next.page ?? 1;
    const bookedPage = next.booked ?? 1;
    if (page > 1) params.set("page", String(page));
    if (bookedPage > 1) params.set("booked", String(bookedPage));
    const qs = params.toString();
    return qs ? `/install-scheduler?${qs}` : "/install-scheduler";
  };
  const readyPages = Math.max(1, Math.ceil(ready.total / ready.pageSize));
  const bookedPages = Math.max(1, Math.ceil(booked.total / booked.pageSize));

  const list = (
    <div className="space-y-8">
      <CrewAvailabilityBoard blocks={crewAvailability} />

      {listError ? (
        <EmptyState icon={CalendarCheck} title={QUEUE_LIST_UNAVAILABLE} />
      ) : ready.total === 0 && booked.total === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={q ? "No jobs match that search" : "No installs to schedule right now"}
          description={q ? "Try a customer, address, or job name." : "Jobs appear here once a work order is ready to schedule."}
        />
      ) : null}

      {needsProps.length ? (
        <section id="needs-a-date">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <CalendarCheck className="size-5 text-primary" /> Needs a date
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-sm font-semibold text-primary">
              {ready.total}
            </span>
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            These jobs can be scheduled. A job with no material lines is included.
            Material jobs show up after the warehouse marks them ready.
          </p>
          <div className="space-y-2">
            {needsProps.map(({ j, props }) => (
              <ClientScheduleRow
                key={j.id}
                name={name(j)}
                city={j.site_city}
                customerId={j.customer_id}
              >
                {props ? (
                  <InstallSchedule {...props} />
                ) : (
                  <p className="px-3 pb-3 text-sm text-muted-foreground">
                    Link this job to an approved estimate to schedule it.
                  </p>
                )}
              </ClientScheduleRow>
            ))}
          </div>
          <WorkQueuePager
            page={ready.page}
            pages={readyPages}
            hrefFor={(page) => schedulerHref({ page, booked: booked.page })}
          />
        </section>
      ) : !listError && ready.total === 0 && booked.total > 0 && !q ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          Every ready job has an install date.
        </div>
      ) : null}

      {booked.rows.length ? (
        <section id="upcoming">
          <h2 className="mb-3 text-lg font-bold">Upcoming installs</h2>
          <div className="divide-y rounded-lg border">
            {booked.rows.map((j) => (
              <Link
                key={j.id}
                href={`/jobs/${j.id}`}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="font-medium">{name(j)}</span>
                  {j.site_city ? (
                    <span className="text-muted-foreground"> · {j.site_city}</span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {j.scheduled_date ? formatDate(j.scheduled_date) : ""}
                  <ChevronRight className="size-4" />
                </span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Tap an install to open its job and reschedule.
          </p>
          <WorkQueuePager
            page={booked.page}
            pages={bookedPages}
            hrefFor={(page) => schedulerHref({ page: ready.page, booked: page })}
          />
        </section>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl pb-16">
      <PageHeader
        title="Install Scheduler"
        description="Jobs that are ready for an install date, and the ones already booked."
      />
      <WorkQueueBar
        action="/install-scheduler"
        query={q}
        placeholder="Search customer, address, or job"
        chips={[
          { href: "#needs-a-date", label: "Needs a date", active: true },
          { href: "#upcoming", label: "Upcoming", active: false },
        ]}
        countLabel={
          listError
            ? listError
            : `${resultCountLabel(ready.rows.length, ready.total, "job")} ready · ${resultCountLabel(booked.rows.length, booked.total, "job")} booked`
        }
      />
      <SchedulerTabs
        needsCount={ready.total}
        list={list}
        calendar={
          <InstallerGrid events={calEvents} resources={calResources} canEdit />
        }
      />
    </div>
  );
}

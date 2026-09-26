import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { WorkQueueBar, WorkQueuePager } from "@/components/work-queue-bar";
import { requireProfile } from "@/lib/auth";
import { listServiceQueue } from "@/lib/data/ops-glue";
import { resolveServiceCallback } from "@/app/(app)/ops/actions";
import { formatDate } from "@/lib/format";
import {
  parseListPage,
  parseServiceQueue,
  resultCountLabel,
  serviceQueueEmpty,
  serviceQueueKindLabel,
  serviceQueueStatusLabel,
  SERVICE_LIST_ROLES,
  type ServiceQueueView,
} from "@/lib/work-queues";

export const metadata: Metadata = { title: "Service / callbacks" };
export const dynamic = "force-dynamic";

const CHIPS: { view: ServiceQueueView; label: string }[] = [
  { view: "open", label: "Open" },
  { view: "scheduled", label: "Scheduled" },
  { view: "completed", label: "Completed" },
  { view: "all", label: "All" },
];

export default async function ServicePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!SERVICE_LIST_ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const view = parseServiceQueue(sp.view);
  const queue = await listServiceQueue({
    view,
    search: q,
    page: parseListPage(sp.page),
  });
  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));

  const href = (next: { view?: ServiceQueueView; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const v = next.view ?? view;
    if (v !== "open") params.set("view", v);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/service?${qs}` : "/service";
  };

  const countLabel = queue.capped
    ? `${resultCountLabel(queue.rows.length, queue.total, "service call")} — more matches exist. Add more of the name or address.`
    : resultCountLabel(queue.rows.length, queue.total, "service call");

  return (
    <div>
      <PageHeader
        title="Service / callbacks"
        description="Punch-list, warranty, and return-trip issues."
      />
      <WorkQueueBar
        action="/service"
        query={q}
        placeholder="Search customer, address, or job"
        hidden={view !== "open" ? [{ name: "view", value: view }] : []}
        chips={CHIPS.map((chip) => ({
          href: href({ view: chip.view, page: 1 }),
          label: chip.label,
          active: view === chip.view,
        }))}
        countLabel={countLabel}
      />
      {queue.rows.length === 0 ? (
        <EmptyState icon={Wrench} title={serviceQueueEmpty(view, !!q)} />
      ) : (
        <ul className="space-y-2">
          {queue.rows.map((r) => {
            const recordHref = r.job_id ? `/jobs/${r.job_id}` : `/customers/${r.customer_id}`;
            const open = r.status !== "resolved" && r.status !== "cancelled";
            return (
              <li key={r.id} className="rounded-xl border bg-card p-3">
                <Link href={recordHref} className="block min-h-11">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{r.customer_name || "Customer"}</div>
                      {r.place ? (
                        <div className="truncate text-sm text-muted-foreground">{r.place}</div>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {serviceQueueStatusLabel(r.status)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {serviceQueueKindLabel(r.category)}
                    {r.follow_up_at ? ` · ${formatDate(r.follow_up_at)}` : ""}
                  </div>
                  {r.description ? <p className="mt-1 line-clamp-2 text-sm">{r.description}</p> : null}
                </Link>
                {open ? (
                  <form action={resolveServiceCallback} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="callback_id" value={r.id} />
                    <input type="hidden" name="job_id" value={r.job_id ?? ""} />
                    <input type="hidden" name="customer_id" value={r.customer_id} />
                    <textarea
                      name="resolution_notes"
                      placeholder="How it was resolved"
                      className="min-h-11 flex-1 rounded-md border px-2 py-2 text-sm"
                    />
                    <Button type="submit" size="sm" variant="outline" className="min-h-11">
                      Resolve
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <WorkQueuePager page={queue.page} pages={pages} hrefFor={(page) => href({ page })} />
    </div>
  );
}

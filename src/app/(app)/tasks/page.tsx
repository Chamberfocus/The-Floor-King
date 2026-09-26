import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ListTodo } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { WorkQueueBar, WorkQueuePager } from "@/components/work-queue-bar";
import { requireProfile } from "@/lib/auth";
import { listTaskQueue } from "@/lib/data/ops-glue";
import { getProfileNames } from "@/lib/data/customers";
import { completeOfficeTask } from "@/app/(app)/ops/actions";
import { formatDate } from "@/lib/format";
import { isTaskOverdue } from "@/lib/office-task";
import {
  parseListPage,
  parseTaskQueue,
  resultCountLabel,
  taskQueueEmpty,
  TASK_LIST_ROLES,
  type TaskQueueView,
} from "@/lib/work-queues";

export const metadata: Metadata = { title: "Tasks" };
export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!TASK_LIST_ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const view = parseTaskQueue(sp.view, profile.role);
  const seeAll = profile.role === "admin" || profile.role === "office" || profile.role === "sales_manager";
  const queue = await listTaskQueue({
    view,
    search: q,
    page: parseListPage(sp.page),
    userId: profile.id,
    seeAll,
  });
  const names = seeAll
    ? await getProfileNames(queue.rows.map((row) => row.assigned_to ?? ""))
    : {};
  const pages = Math.max(1, Math.ceil(queue.total / queue.pageSize));
  const defaultView: TaskQueueView = profile.role === "salesman" ? "mine" : "open";
  const chips: { view: TaskQueueView; label: string }[] =
    profile.role === "salesman"
      ? [
          { view: "mine", label: "Mine" },
          { view: "overdue", label: "Overdue" },
          { view: "completed", label: "Completed" },
        ]
      : [
          { view: "mine", label: "Mine" },
          { view: "open", label: "Open" },
          { view: "overdue", label: "Overdue" },
          { view: "completed", label: "Completed" },
        ];

  const href = (next: { view?: TaskQueueView; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const v = next.view ?? view;
    if (v !== defaultView) params.set("view", v);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/tasks?${qs}` : "/tasks";
  };

  const countLabel = queue.capped
    ? `${resultCountLabel(queue.rows.length, queue.total, "task")} — more matches exist. Add more of the name.`
    : resultCountLabel(queue.rows.length, queue.total, "task");

  return (
    <div>
      <PageHeader
        title="Tasks"
        description={seeAll ? "Office follow-ups across the shop." : "Tasks assigned to you."}
      />
      <WorkQueueBar
        action="/tasks"
        query={q}
        placeholder={seeAll ? "Search task, customer, or assignee" : "Search task or customer"}
        hidden={view !== defaultView ? [{ name: "view", value: view }] : []}
        chips={chips.map((chip) => ({
          href: href({ view: chip.view, page: 1 }),
          label: chip.label,
          active: view === chip.view,
        }))}
        countLabel={countLabel}
      />
      {queue.rows.length === 0 ? (
        <EmptyState icon={ListTodo} title={taskQueueEmpty(view, !!q)} />
      ) : (
        <ul className="space-y-2">
          {queue.rows.map((task) => {
            const recordHref = task.customer_id
              ? `/customers/${task.customer_id}`
              : task.job_id
                ? `/jobs/${task.job_id}`
                : null;
            const overdue = isTaskOverdue({ status: task.status, dueAt: task.due_at });
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{task.title}</div>
                    {task.customer_name ? (
                      <div className="truncate text-sm text-muted-foreground">{task.customer_name}</div>
                    ) : null}
                  </div>
                  {overdue ? (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      Overdue
                    </span>
                  ) : task.status === "completed" ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      Completed
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {task.due_at ? formatDate(task.due_at) : "No due date"}
                  {seeAll && task.assigned_to
                    ? ` · ${names[task.assigned_to] ?? "Assigned"}`
                    : ""}
                </div>
                {task.description ? (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>
                ) : null}
              </>
            );
            return (
              <li key={task.id} className="rounded-xl border bg-card p-3">
                {recordHref ? (
                  <Link href={recordHref} className="block min-h-11">
                    {body}
                  </Link>
                ) : (
                  <div className="min-h-11">{body}</div>
                )}
                {task.status !== "completed" && task.status !== "cancelled" ? (
                  <form action={completeOfficeTask} className="mt-3">
                    <input type="hidden" name="task_id" value={task.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
                    >
                      Done
                    </button>
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

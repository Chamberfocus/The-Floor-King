"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ListTodo } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { completeOfficeTask, createOfficeTask } from "@/app/(app)/ops/actions";
import type { OfficeTaskRow } from "@/lib/data/ops-glue";
import { formatDate } from "@/lib/format";
import Link from "next/link";

export function MyOfficeTasksCard({
  buckets,
  canAssign,
  assignees,
}: {
  buckets: {
    overdue: OfficeTaskRow[];
    dueToday: OfficeTaskRow[];
    upcoming: OfficeTaskRow[];
    completed: OfficeTaskRow[];
  };
  canAssign: boolean;
  assignees: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const openCount =
    buckets.overdue.length + buckets.dueToday.length + buckets.upcoming.length;

  const complete = (taskId: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("task_id", taskId);
      try {
        await completeOfficeTask(fd);
        toast.success("Task completed");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not complete");
      }
    });

  const Section = ({
    title,
    items,
    urgent,
  }: {
    title: string;
    items: OfficeTaskRow[];
    urgent?: boolean;
  }) =>
    items.length ? (
      <div className="space-y-1.5">
        <div
          className={`text-xs font-semibold uppercase tracking-wide ${
            urgent ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {title}
        </div>
        <ul className="space-y-1">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-muted-foreground">
                  {t.due_at ? `Due ${formatDate(t.due_at)}` : "No due date"}
                  {t.job_id ? (
                    <>
                      {" · "}
                      <Link href={`/jobs/${t.job_id}`} className="underline">
                        Job
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>
              {t.status !== "completed" && t.status !== "cancelled" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => complete(t.id)}
                  aria-label="Complete task"
                >
                  <CheckCircle2 className="size-4" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ListTodo className="size-4" /> My tasks
          {openCount ? (
            <span className="text-xs font-normal text-muted-foreground">
              ({openCount} open)
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!openCount ? (
          <p className="text-sm text-muted-foreground">No open assigned tasks.</p>
        ) : null}
        <Section title="Overdue" items={buckets.overdue} urgent />
        <Section title="Due today" items={buckets.dueToday} />
        <Section title="Upcoming" items={buckets.upcoming} />

        {canAssign ? (
            <form action={createOfficeTask} className="space-y-2 border-t pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Assign a task
            </div>
            <input
              name="title"
              required
              placeholder="What needs doing?"
              className="h-9 w-full rounded-md border px-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select
                name="assigned_to"
                className="h-9 rounded-md border px-2 text-sm"
                defaultValue=""
              >
                <option value="">Assign to me</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <input
                type="datetime-local"
                name="due_at"
                className="h-9 rounded-md border px-2 text-sm"
              />
              <select name="priority" className="h-9 rounded-md border px-2 text-sm" defaultValue="normal">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <Button type="submit" size="sm">
                Create
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * The signed-in person's waiting list. Home queues plus their own tasks.
 */
import { listMyOfficeTasks } from "@/lib/data/ops-glue";
import { loadHomePeople } from "@/lib/data/home-people";
import { mergeWatchPeople, type WatchTask } from "@/lib/ball-watch";
import { TASK_LIST_ROLES } from "@/lib/work-queues";
import type { HomePerson } from "@/lib/home-people";
import type { UserRole } from "@/lib/types";

function asWatch(rows: { id: string; title: string; customer_id: string | null; job_id: string | null; source_key: string | null }[]): WatchTask[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    customer_id: row.customer_id,
    job_id: row.job_id,
    source_key: row.source_key,
  }));
}

export async function loadBallPeople(args: {
  role: UserRole;
  userId: string;
}): Promise<HomePerson[]> {
  const [people, tasks] = await Promise.all([
    loadHomePeople(args),
    listMyOfficeTasks(args.userId),
  ]);
  return mergeWatchPeople(
    people,
    { overdue: asWatch(tasks.overdue), dueToday: asWatch(tasks.dueToday) },
    TASK_LIST_ROLES.includes(args.role),
  );
}

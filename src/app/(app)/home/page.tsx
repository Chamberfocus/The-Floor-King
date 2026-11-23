import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { loadHomeCenter } from "@/lib/data/home-center";
import { loadHomePeople } from "@/lib/data/home-people";
import { listMyOfficeTasks } from "@/lib/data/ops-glue";
import { mergeWatchPeople } from "@/lib/ball-watch";
import { TASK_LIST_ROLES } from "@/lib/work-queues";
import { HomeCenterView } from "@/components/home-center-view";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] || "there";
  const [board, loadedPeople, tasks] = await Promise.all([
    loadHomeCenter({
      role: profile.role,
      userId: profile.id,
      firstName,
    }),
    loadHomePeople({ role: profile.role, userId: profile.id }),
    listMyOfficeTasks(profile.id),
  ]);
  const people = mergeWatchPeople(
    loadedPeople,
    { overdue: tasks.overdue, dueToday: tasks.dueToday },
    TASK_LIST_ROLES.includes(profile.role),
  );
  const seesSchedule = [
    "admin",
    "office",
    "sales_manager",
    "salesman",
    "scheduler",
  ].includes(profile.role);
  return (
    <HomeCenterView
      board={board}
      people={people}
      customersHref={seesSchedule ? "/customers" : null}
      scheduleHref={seesSchedule ? "/calendar" : null}
    />
  );
}

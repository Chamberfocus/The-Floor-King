/**
 * Home counts. Each number is the total from the same queue the link opens.
 * Reads use the signed-in client so row security still applies.
 * One row is enough to read total_count. Financial columns are not selected.
 */
import { createClient } from "@/lib/supabase/server";
import { readQueuePage } from "@/lib/data/queue-rpc";
import { countJobsOnDate } from "@/lib/data/jobs";
import { shopTodayYmd } from "@/lib/job-snapshot";
import {
  homeCommandText,
  homeCommandsForRole,
  homeEstimateCountArgs,
  homeJobQueueArgs,
  homeTaskCountArgs,
  homeTodayScope,
  type HomeCommandId,
  type HomeCommandSpec,
} from "@/lib/home-command";
import { DEFAULT_ESTIMATE_FOLLOWUP_DAYS } from "@/lib/ops-followup";
import { QUEUE_LIST_UNAVAILABLE } from "@/lib/ops-scale";
import type { UserRole } from "@/lib/types";

export type HomeCommandItem = {
  id: HomeCommandId;
  href: string;
  text: string;
  count: number;
};

export type HomeCommandBoard = {
  greeting: string;
  items: HomeCommandItem[];
  unavailable: boolean;
};

type Db = Awaited<ReturnType<typeof createClient>>;

async function total(
  db: Db,
  fn: string,
  args: Record<string, unknown>,
): Promise<number> {
  const found = await readQueuePage(db, fn, { ...args, p_limit: 1, p_offset: 0 });
  return found.total;
}

async function crewIdsFor(db: Db, userId: string): Promise<string[]> {
  const { data } = await db
    .from("install_crews")
    .select("id")
    .eq("profile_id", userId)
    .eq("active", true);
  return (data ?? []).map((row) => row.id as string);
}

export async function loadHomeCenter(args: {
  role: UserRole;
  userId: string;
  firstName: string;
}): Promise<HomeCommandBoard> {
  const specs = homeCommandsForRole(args.role);
  const userDb = await createClient();
  let crewIds: Promise<string[]> | null = null;
  const linkedCrewIds = () => {
    crewIds ??= crewIdsFor(userDb, args.userId);
    return crewIds;
  };
  const today = shopTodayYmd();
  const followupBefore = new Date(
    Date.now() - DEFAULT_ESTIMATE_FOLLOWUP_DAYS * 86_400_000,
  ).toISOString();

  const countFor = async (spec: HomeCommandSpec): Promise<number> => {
    if (spec.id === "followups") {
      const { count, error } = await userDb
        .from("customers")
        .select("id", { count: "exact", head: true })
        .is("cancelled_at", null)
        .not("next_action_due", "is", null)
        .lt("next_action_due", new Date().toISOString());
      if (error) throw new Error(QUEUE_LIST_UNAVAILABLE);
      return count ?? 0;
    }
    if (spec.id === "estimates") {
      return total(
        userDb,
        "estimate_queue_page",
        homeEstimateCountArgs(args.role, args.userId, followupBefore),
      );
    }
    if (spec.id === "material" || spec.id === "ready") {
      const linked = args.role === "crew" ? await linkedCrewIds() : [];
      return total(
        userDb,
        "job_queue_page",
        homeJobQueueArgs({
          role: args.role,
          userId: args.userId,
          queue: spec.id,
          crewIds: linked,
        }),
      );
    }
    if (spec.id === "today") {
      return countJobsOnDate({
        date: today,
        ...homeTodayScope(args.role, args.userId),
      });
    }
    if (spec.id === "service") {
      return total(userDb, "service_queue_page", {
        p_statuses: ["open", "in_progress", "waiting"],
        p_search: null,
      });
    }
    if (spec.id === "tasks") {
      return total(
        userDb,
        "task_queue_page",
        homeTaskCountArgs(args.role, args.userId, new Date().toISOString()),
      );
    }
    if (spec.id === "orders") {
      return total(userDb, "order_queue_page", {
        p_statuses: ["submitted"],
        p_search: null,
        p_phone_like: null,
        p_digits: null,
      });
    }
    return total(
      userDb,
      "job_queue_page",
      homeJobQueueArgs({
        role: args.role,
        userId: args.userId,
        queue: "warehouse_active",
      }),
    );
  };

  const settled = await Promise.all(
    specs.map(async (spec) => {
      try {
        const count = await countFor(spec);
        return { spec, count, failed: false };
      } catch {
        return { spec, count: 0, failed: true };
      }
    }),
  );

  const items: HomeCommandItem[] = settled
    .filter((row) => !row.failed && row.count > 0)
    .map((row) => ({
      id: row.spec.id,
      href: row.spec.href,
      count: row.count,
      text: homeCommandText(row.count, row.spec),
    }));

  return {
    greeting: `Hello, ${args.firstName}`,
    items,
    unavailable: settled.length > 0 && settled.every((row) => row.failed),
  };
}

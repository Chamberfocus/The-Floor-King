/**
 * Home counts. Each number is the total from the same queue the link opens.
 * One row is enough to read total_count. No deposit, invoice, cost, or margin.
 */
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readQueuePage } from "@/lib/data/queue-rpc";
import { countJobsOnDate } from "@/lib/data/jobs";
import { shopTodayYmd } from "@/lib/job-snapshot";
import {
  homeCommandText,
  homeCommandsForRole,
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
  let crewPack: Promise<{ db: Db; ids: string[] }> | null = null;
  const crewScope = () => {
    crewPack ??= (async () => {
      const db = createAdminClient();
      return { db, ids: await crewIdsFor(db, args.userId) };
    })();
    return crewPack;
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
      return total(userDb, "estimate_queue_page", {
        p_status: "sent",
        p_sent_before: followupBefore,
        p_mine: args.role === "salesman" ? args.userId : null,
        p_search: null,
      });
    }
    if (spec.id === "material" || spec.id === "ready") {
      const crew = args.role === "crew" ? await crewScope() : null;
      return total(crew?.db ?? userDb, "job_queue_page", {
        p_queue: spec.id === "material" ? "material" : "ready",
        p_search: null,
        p_phone_like: null,
        p_digits: null,
        p_mine: args.role === "salesman" ? args.userId : null,
        p_assigned: args.role === "crew" ? args.userId : null,
        p_crew_ids: crew && crew.ids.length ? crew.ids : null,
        p_keep_pickup: false,
      });
    }
    if (spec.id === "today") {
      return countJobsOnDate({
        date: today,
        assignedTo: args.role === "crew" ? args.userId : undefined,
        mineFor: args.role === "salesman" ? args.userId : undefined,
      });
    }
    if (spec.id === "service") {
      return total(userDb, "service_queue_page", {
        p_statuses: ["open", "in_progress", "waiting"],
        p_search: null,
      });
    }
    if (spec.id === "tasks") {
      return total(userDb, "task_queue_page", {
        p_view: "open",
        p_user: args.userId,
        p_see_all: args.role !== "salesman",
        p_now: new Date().toISOString(),
        p_search: null,
      });
    }
    if (spec.id === "orders") {
      return total(userDb, "order_queue_page", {
        p_statuses: ["submitted"],
        p_search: null,
        p_phone_like: null,
        p_digits: null,
      });
    }
    return total(createAdminClient(), "job_queue_page", {
      p_queue: "warehouse_active",
      p_search: null,
      p_phone_like: null,
      p_digits: null,
      p_mine: null,
      p_assigned: null,
      p_crew_ids: null,
      p_keep_pickup: true,
    });
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

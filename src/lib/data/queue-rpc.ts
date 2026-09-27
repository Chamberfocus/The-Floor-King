import { QUEUE_LIST_UNAVAILABLE, logQueueFailure } from "@/lib/ops-scale";
import { phoneSearchPattern } from "@/lib/search-query";
import { sanitizeIlikeQuery } from "@/lib/ops-followup";
import { listPageWindow } from "@/lib/work-queues";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

export function queueSearchArgs(search: string | undefined) {
  const safe = sanitizeIlikeQuery(search ?? "");
  const digits = (search ?? "").replace(/\D/g, "");
  return {
    p_search: safe.length >= 2 ? safe : null,
    p_phone_like: phoneSearchPattern(search ?? ""),
    p_digits: digits.length >= 7 ? digits : null,
  };
}

/** One database page. A null id means the page is empty and total_count still applies. */
export async function readQueuePage(
  supabase: RpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ids: string[]; total: number }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    logQueueFailure(fn, error);
    throw new Error(QUEUE_LIST_UNAVAILABLE);
  }
  const rows = (data ?? []) as { id: string | null; total_count: number | string | null }[];
  const total = Number(rows[0]?.total_count ?? 0);
  return {
    ids: rows.map((row) => row.id).filter((id): id is string => !!id),
    total: Number.isFinite(total) ? total : 0,
  };
}

export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Clamp a requested page onto the database window, including a short last page. */
export async function readQueueWindow(
  supabase: RpcClient,
  fn: string,
  args: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<{ ids: string[]; total: number; page: number; pageSize: number }> {
  const requested = Math.max(1, page);
  const load = (offset: number) =>
    readQueuePage(supabase, fn, { ...args, p_limit: pageSize, p_offset: offset });
  let found = await load((requested - 1) * pageSize);
  if (!found.ids.length && found.total > 0 && (requested - 1) * pageSize >= found.total) {
    const last = listPageWindow(requested, pageSize, found.total);
    found = await load(last.from);
  }
  const window = listPageWindow(requested, pageSize, found.total);
  return { ids: found.ids, total: found.total, page: window.page, pageSize };
}

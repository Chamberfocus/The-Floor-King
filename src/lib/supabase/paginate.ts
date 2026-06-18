// PostgREST caps a single response at 1000 rows. Any money/aggregation query
// that can grow unbounded (invoice items, payments, labor, line items, stock
// movements) must page through with .range() or it silently undercounts once
// the business passes 1000 rows. This helper loops until a short page returns.

const PAGE = 1000;

/**
 * Fetch every row for a query, a page at a time. Pass a factory that builds the
 * query and applies `.range(from, to)` — e.g.
 *   fetchAll<Payment>((from, to) =>
 *     supabase.from("payments").select("*").gte("paid_at", start).range(from, to))
 */
export async function fetchAll<T>(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await makeQuery(from, from + PAGE - 1);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

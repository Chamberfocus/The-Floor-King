import { redirect } from "next/navigation";

/**
 * Pipeline is now Client status.
 *
 * Same customers, same stages, folded into six lanes instead of thirteen
 * headings. Kept as a redirect so bookmarks, saved links and anything still
 * pointing here land in the right place rather than 404ing.
 *
 * It used to redirect bare, throwing the query string away — so "?mine=1&
 * overdue=1", which is what the dashboard's overdue badge and the daily email
 * both sent, arrived as the unfiltered book. You clicked "3 overdue" and got
 * forty-one clients. The params are translated to Client status's own names and
 * carried across now.
 */
export default async function PipelineRedirect({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string; who?: string; overdue?: string }>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.mine === "1" || sp.who === "mine") q.set("who", "mine");
  if (sp.overdue === "1") q.set("overdue", "1");
  const query = q.toString();
  redirect(`/client-status${query ? `?${query}` : ""}`);
}

import type { Metadata } from "next";
import Link from "next/link";
import { Plus, FileText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { listEstimatesQueue, type EstimateListRow } from "@/lib/data/estimates";
import { WorkQueueBar, WorkQueuePager } from "@/components/work-queue-bar";
import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  estimateQueueEmpty,
  estimateQueueMine,
  parseEstimateQueue,
  parseListPage,
  resultCountLabel,
  roleSeesMoneyList,
} from "@/lib/work-queues";
import { optionTotals } from "@/lib/estimate-calc";
import { formatMoney, formatDate } from "@/lib/format";
import { DeleteEstimateButton, ClearDraftsButton } from "./estimate-list-actions";

export const metadata: Metadata = { title: "Estimates" };

function headlineTotal(e: EstimateListRow): number {
  const opts = e.options ?? [];
  const opt =
    (e.accepted_option_id && opts.find((o) => o.id === e.accepted_option_id)) ||
    opts[0];
  if (!opt) return 0;
  return optionTotals(opt.line_items ?? [], e.tax_rate).total;
}

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; who?: string; page?: string }>;
}) {
  const profile = await requireProfile();
  if (!roleSeesMoneyList(profile.role)) redirect("/");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const view = parseEstimateQueue(sp.view);
  const mine = estimateQueueMine(sp.who, profile.role);
  const queue = await listEstimatesQueue({
    view,
    search: q,
    page: parseListPage(sp.page),
    mineFor: mine ? profile.id : null,
  });
  const estimates = queue.rows;
  const estimateHref = (next: { view?: string; who?: string; page?: number }) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const v = next.view ?? view;
    if (v !== "all") params.set("view", v);
    const who = next.who ?? (mine ? "mine" : "all");
    if (who === "mine") params.set("who", "mine");
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    return qs ? `/estimates?${qs}` : "/estimates";
  };

  return (
    <div>
      <PageHeader
        title="Estimates"
        description="Every estimate across all customers."
      >
        {/* "Quick estimate" used to sit here as its own button — the only place
            in the app you could reach it. It's one of the four choices inside
            New estimate now, offered wherever you start one. */}
        <div className="flex items-center gap-2">
          <ClearDraftsButton />
          <Link href="/estimates/start" className={buttonVariants({ size: "lg" })}>
            <Plus className="size-4" /> New estimate
          </Link>
        </div>
      </PageHeader>

      <WorkQueueBar
        action="/estimates"
        query={q}
        placeholder="Search customer, estimate, or address"
        hidden={[
          ...(view !== "all" ? [{ name: "view", value: view }] : []),
          ...(mine ? [{ name: "who", value: "mine" }] : []),
        ]}
        chips={[
          { href: estimateHref({ view: "all", page: 1 }), label: "All", active: view === "all" },
          { href: estimateHref({ view: "draft", page: 1 }), label: "Draft", active: view === "draft" },
          { href: estimateHref({ view: "sent", page: 1 }), label: "Sent", active: view === "sent" },
          { href: estimateHref({ view: "followup", page: 1 }), label: "Follow-up", active: view === "followup" },
          { href: estimateHref({ view: "approved", page: 1 }), label: "Approved", active: view === "approved" },
          { href: estimateHref({ who: mine ? "all" : "mine", page: 1 }), label: mine ? "All salespeople" : "Mine", active: false },
        ]}
        countLabel={
          queue.capped
            ? `${resultCountLabel(estimates.length, queue.total, "estimate")} — more matches exist. Add more of the name or address.`
            : resultCountLabel(estimates.length, queue.total, "estimate")
        }
      />

      {estimates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={estimateQueueEmpty(view, !!q)}
          description="Find the customer, then pick how to build it: the guided questionnaire, a quick few lines, or straight into the builder."
          action={
            <Link href="/estimates/start" className={buttonVariants({})}>
              <Plus className="size-4" /> New estimate
            </Link>
          }
        />
      ) : (
        <>
        {/* Phone: tappable cards (delete sits outside the link) */}
        <div className="space-y-2 md:hidden">
          {estimates.map((e) => (
            <div key={e.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/estimates/${e.id}`} className="min-w-0 flex-1">
                  <div className="truncate font-medium">{e.title || "Estimate"}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {e.customer_name ?? "—"} · {(e.options ?? []).length} option
                    {(e.options ?? []).length === 1 ? "" : "s"}
                  </div>
                </Link>
                <EstimateStatusBadge status={e.status} />
                <DeleteEstimateButton id={e.id} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{formatMoney(headlineTotal(e))}</span>
                <span className="ml-auto">{formatDate(e.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Larger screens: table */}
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estimate</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {estimates.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Link href={`/estimates/${e.id}`} className="hover:underline">
                      {e.title || "Estimate"}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {(e.options ?? []).length} option
                      {(e.options ?? []).length === 1 ? "" : "s"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/customers/${e.customer_id}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {e.customer_name ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <EstimateStatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(headlineTotal(e))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(e.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteEstimateButton id={e.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
      <WorkQueuePager
        page={queue.page}
        pages={Math.max(1, Math.ceil(queue.total / queue.pageSize) || 1)}
        hrefFor={(page) => estimateHref({ page })}
      />
    </div>
  );
}

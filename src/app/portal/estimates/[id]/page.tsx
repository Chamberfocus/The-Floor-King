import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { CustomerScopeView } from "@/components/customer-scope-view";
import { EstimateOptionCards } from "@/components/estimate-option-cards";
import { EstimateViewBeacon } from "@/components/estimate-view-beacon";
import {
  getPortalApprovalSnapshot,
  getPortalEstimate,
  getPortalOrgSettings,
  listPortalApprovalSnapshots,
} from "@/lib/data/portal-commercial";
import { buildCustomerScope, parseProjectDetails, customerLineLabel } from "@/lib/customer-scope";
import { optionTotalsWithDiscount, lineTotal } from "@/lib/estimate-calc";
import { snapshotItemGroups } from "@/lib/approval-snapshot-view";
import { legacyApprovalSnapshotUnavailable } from "@/lib/estimate-approval";
import { formatMoney } from "@/lib/format";
import type { EstimateOption } from "@/lib/types";
import {
  portalApproveEstimate,
  portalDeclineEstimate,
  portalRequestChanges,
} from "../../actions";

export const metadata: Metadata = { title: "Estimate" };

function CommercialCard(props: {
  title: string;
  itemized: boolean;
  itemGroups: { room: string; items: { label: string; note: string; amount: number }[] }[];
  scope: ReturnType<typeof buildCustomerScope>;
  narrative: string | null;
  projectDetails: string[];
  totals: { subtotal: number; discount: number; tax: number; total: number };
  badge?: string;
}) {
  const {
    title,
    itemized,
    itemGroups,
    scope,
    narrative,
    projectDetails,
    totals,
    badge,
  } = props;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">
          {title}
          {badge ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({badge})
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {itemized ? (
          <div className="space-y-3">
            {itemGroups.map((g) => (
              <div key={g.room}>
                <h3 className="text-base font-bold">{g.room}</h3>
                <ul className="mt-1 divide-y">
                  {g.items.map((it, i) => (
                    <li
                      key={i}
                      className="flex items-baseline justify-between gap-4 py-1 text-[15px]"
                    >
                      <span>
                        {it.label}
                        {it.note ? (
                          <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">
                            {it.note}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {formatMoney(it.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <CustomerScopeView scope={scope} variant="full" narrative={narrative} />
        )}
        {projectDetails.length > 0 ? (
          <div className="mt-6 border-t pt-5">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Project details
            </div>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-[15px] leading-relaxed sm:grid-cols-2">
              {projectDetails.map((d, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-current opacity-40"
                  />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {itemized && (totals.discount > 0 || totals.tax > 0) ? (
          <div className="mt-6 space-y-1 border-t pt-4 text-[15px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
            </div>
            {totals.discount > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Discount</span>
                <span className="tabular-nums">−{formatMoney(totals.discount)}</span>
              </div>
            ) : null}
            {totals.tax > 0 ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="tabular-nums">{formatMoney(totals.tax)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex items-baseline justify-between border-t-2 pt-4">
          <span className="text-sm font-semibold uppercase tracking-wide">
            {itemized ? "Total" : "Project total"}
          </span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(totals.total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {itemized
            ? "All-inclusive — materials, professional installation, and site preparation as itemized above. Applicable tax included."
            : "One all-inclusive price — materials, professional installation, and site preparation as described. Applicable tax included."}
        </p>
      </CardContent>
    </Card>
  );
}

export default async function PortalEstimatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ approval_error?: string }>;
}) {
  const { id } = await params;
  const { approval_error: approvalError } = await searchParams;
  const estimate = await getPortalEstimate(id);
  if (!estimate) notFound();
  const org = await getPortalOrgSettings();
  const currentSnap = await getPortalApprovalSnapshot(id);
  const allSnaps = await listPortalApprovalSnapshots(id);

  const options = estimate.options ?? [];
  const canRespond =
    estimate.status === "sent" || estimate.status === "changes_requested";
  const totalsFor = (o: EstimateOption) =>
    optionTotalsWithDiscount(
      o.line_items ?? [],
      estimate.tax_rate,
      estimate.discount_kind,
      estimate.discount_value,
    );

  const showComparison =
    options.length > 1 &&
    !estimate.accepted_option_id &&
    !currentSnap &&
    canRespond;

  const chosen =
    options.find((o) => o.id === estimate.accepted_option_id) ?? options[0] ?? null;
  const chosenLines = chosen?.line_items ?? [];
  const scope = buildCustomerScope(chosenLines, estimate.job_description);
  const chosenTotals = chosen ? totalsFor(chosen) : null;
  const itemized = estimate.presentation !== "summary";
  const projectDetails =
    estimate.show_project_details === false
      ? []
      : parseProjectDetails(estimate.job_description).details;
  const itemGroups: {
    room: string;
    items: { label: string; note: string; amount: number }[];
  }[] = [];
  if (itemized) {
    const at = new Map<string, number>();
    for (const l of chosenLines) {
      const amount = lineTotal(l);
      if (!(amount > 0)) continue;
      const room = (l.room ?? "").trim() || "Project";
      if (!at.has(room)) {
        at.set(room, itemGroups.length);
        itemGroups.push({ room, items: [] });
      }
      itemGroups[at.get(room)!].items.push({
        label: customerLineLabel(l),
        note: (l.note ?? "").trim(),
        amount,
      });
    }
  }

  const legacyMissing = legacyApprovalSnapshotUnavailable(
    estimate.status,
    !!currentSnap,
  );
  const revisionPending = canRespond && !!currentSnap;
  const approvedWithSnap = estimate.status === "approved" && !!currentSnap;

  return (
    <div>
      <EstimateViewBeacon estimateId={id} />
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>

      <div className="mb-2 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
          {estimate.title || "Estimate"}
        </h1>
        <EstimateStatusBadge status={estimate.status} />
      </div>

      {approvalError ? (
        <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {approvalError}
        </p>
      ) : null}

      {legacyMissing ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Historical approval snapshot unavailable. This estimate was approved
          before approval history was recorded — the details below are the
          current commercial record, not a verified copy of the original
          acceptance.
        </p>
      ) : null}

      {revisionPending ? (
        <p className="mb-4 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
          A revised proposal is awaiting your approval. Your previously approved
          version is shown first; the new proposal is separate below.
        </p>
      ) : null}

      {estimate.valid_until
        ? (() => {
            const expired =
              new Date(estimate.valid_until) <
              new Date(new Date().toISOString().slice(0, 10));
            return (
              <p
                className={
                  expired
                    ? "mb-6 text-sm font-medium text-destructive"
                    : "mb-6 text-sm text-muted-foreground"
                }
              >
                {expired
                  ? `This estimate expired on ${estimate.valid_until} — please contact us for current pricing.`
                  : `Valid until ${estimate.valid_until}.`}
              </p>
            );
          })()
        : null}

      {/* Previously approved (immutable snapshot) */}
      {currentSnap && (approvedWithSnap || revisionPending) ? (
        <CommercialCard
          title={
            revisionPending
              ? `Previously approved — ${currentSnap.payload.option.name}`
              : estimate.accepted_option_id && options.length > 1
                ? `Your project — ${currentSnap.payload.option.name}`
                : "Your project"
          }
          badge={
            revisionPending
              ? `v${currentSnap.version} · ${new Date(currentSnap.approved_at).toLocaleDateString()}`
              : allSnaps.length > 1
                ? `Approved v${currentSnap.version}`
                : undefined
          }
          {...snapshotItemGroups(currentSnap.payload)}
          narrative={currentSnap.payload.job_description}
        />
      ) : null}

      {/* Live revised proposal (not yet approved) or live when no snapshot */}
      {revisionPending || (!currentSnap && !approvedWithSnap) ? (
        showComparison ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">
                Your options — choose the one that fits
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {projectDetails.length > 0 ? (
                <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-[15px] leading-relaxed sm:grid-cols-2">
                  {projectDetails.map((d, i) => (
                    <li key={i} className="flex gap-2">
                      <span
                        aria-hidden
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-current opacity-40"
                      />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <EstimateOptionCards
                estimate={estimate}
                renderAction={
                  canRespond
                    ? (o) => (
                        <form action={portalApproveEstimate}>
                          <input type="hidden" name="estimate_id" value={estimate.id} />
                          <input type="hidden" name="accepted_option_id" value={o.id} />
                          <Button type="submit" className="w-full">
                            <Check className="size-4" /> Choose {o.name}
                          </Button>
                        </form>
                      )
                    : undefined
                }
              />
            </CardContent>
          </Card>
        ) : chosenTotals ? (
          <CommercialCard
            title={
              revisionPending
                ? `Revised proposal — ${chosen?.name ?? "updated estimate"}`
                : estimate.accepted_option_id && options.length > 1
                  ? `Your project — ${chosen?.name ?? "selected option"}`
                  : "Your project"
            }
            badge={revisionPending ? "Awaiting your approval" : undefined}
            itemized={itemized}
            itemGroups={itemGroups}
            scope={scope}
            narrative={estimate.job_description}
            projectDetails={projectDetails}
            totals={{
              subtotal: chosenTotals.subtotal,
              discount: chosenTotals.discount,
              tax: chosenTotals.tax,
              total: chosenTotals.total,
            }}
          />
        ) : null
      ) : null}

      {org.financing_url ? (
        <Card className="mt-6 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-medium">Need flexible payments?</p>
              <p className="text-sm text-muted-foreground">
                Apply for financing in minutes — quick, no obligation.
              </p>
            </div>
            <Button
              render={
                <a href={org.financing_url} target="_blank" rel="noopener noreferrer" />
              }
            >
              Apply for financing
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {estimate.customer_response_note && estimate.status !== "approved" ? (
        <p className="mt-4 rounded-md bg-muted p-3 text-sm">
          <span className="font-medium">Your note:</span>{" "}
          {estimate.customer_response_note}
        </p>
      ) : null}

      {canRespond ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              {showComparison
                ? "Prefer to talk it over?"
                : revisionPending
                  ? "Approve the revised proposal?"
                  : "Your decision"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showComparison ? (
              <form
                action={portalApproveEstimate}
                className="flex flex-wrap items-end gap-2"
              >
                <input type="hidden" name="estimate_id" value={estimate.id} />
                <input
                  type="hidden"
                  name="accepted_option_id"
                  value={chosen?.id ?? options[0]?.id ?? ""}
                />
                <Button type="submit">
                  <Check className="size-4" />{" "}
                  {revisionPending ? "Approve revised estimate" : "Approve estimate"}
                </Button>
              </form>
            ) : null}

            <details className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Request changes or decline
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <form action={portalRequestChanges} className="space-y-2">
                  <input type="hidden" name="estimate_id" value={estimate.id} />
                  <textarea
                    name="note"
                    rows={2}
                    required
                    placeholder="What would you like changed? (e.g. different product, lower price)"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <Button type="submit" variant="outline" size="sm">
                    Request changes
                  </Button>
                </form>
                <form action={portalDeclineEstimate} className="space-y-2">
                  <input type="hidden" name="estimate_id" value={estimate.id} />
                  <textarea
                    name="note"
                    rows={2}
                    required
                    placeholder="Reason for declining"
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <Button type="submit" variant="outline" size="sm">
                    Decline
                  </Button>
                </form>
              </div>
            </details>
          </CardContent>
        </Card>
      ) : null}

      {org.freight_disclaimer ? (
        <p className="mt-6 text-xs text-muted-foreground">
          {org.freight_disclaimer}
        </p>
      ) : null}
    </div>
  );
}

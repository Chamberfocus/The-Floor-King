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
import { getEstimate } from "@/lib/data/estimates";
import { getOrgSettings } from "@/lib/data/org";
import { buildCustomerScope } from "@/lib/customer-scope";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";
import type { EstimateOption } from "@/lib/types";
import {
  portalApproveEstimate,
  portalDeclineEstimate,
  portalRequestChanges,
} from "../../actions";

export const metadata: Metadata = { title: "Estimate" };

export default async function PortalEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimate(id);
  if (!estimate) notFound();
  const org = await getOrgSettings();

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

  // Multiple options, none chosen yet → let the customer compare side by side.
  const showComparison = options.length > 1 && !estimate.accepted_option_id;

  // Single view: the option they accepted, else the first.
  const chosen =
    options.find((o) => o.id === estimate.accepted_option_id) ?? options[0] ?? null;
  const scope = buildCustomerScope(chosen?.line_items ?? [], estimate.notes);
  const total = chosen ? totalsFor(chosen).total : 0;
  const variant = estimate.presentation === "summary" ? "condensed" : "full";

  return (
    <div>
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

      {showComparison ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Your options — choose the one that fits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {estimate.job_description ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {estimate.job_description}
              </p>
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
            <p className="text-xs text-muted-foreground">
              Each price is all-inclusive — materials, professional installation,
              and site preparation as described. Applicable tax included.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              {estimate.accepted_option_id && options.length > 1
                ? `Your project — ${chosen?.name ?? "selected option"}`
                : "Your project"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerScopeView
              scope={scope}
              variant={variant}
              narrative={estimate.job_description}
            />
            <div className="mt-5 flex items-baseline justify-between border-t-2 pt-4">
              <span className="text-sm font-semibold uppercase tracking-wide">
                Project total
              </span>
              <span className="text-2xl font-bold tabular-nums">
                {formatMoney(total)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              One all-inclusive price — materials, professional installation, and
              site preparation as described. Applicable tax included.
            </p>
          </CardContent>
        </Card>
      )}

      {org.financing_url ? (
        <Card className="mt-6 border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="font-medium">Need flexible payments?</p>
              <p className="text-sm text-muted-foreground">
                Apply for financing in minutes — quick, no obligation.
              </p>
            </div>
            <Button render={<a href={org.financing_url} target="_blank" rel="noopener noreferrer" />}>
              Apply for financing
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {estimate.customer_response_note &&
      estimate.status !== "approved" ? (
        <p className="mt-4 rounded-md bg-muted p-3 text-sm">
          <span className="font-medium">Your note:</span>{" "}
          {estimate.customer_response_note}
        </p>
      ) : null}

      {/* Respond */}
      {canRespond ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">
              {showComparison ? "Prefer to talk it over?" : "Your decision"}
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
                  <Check className="size-4" /> Approve estimate
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

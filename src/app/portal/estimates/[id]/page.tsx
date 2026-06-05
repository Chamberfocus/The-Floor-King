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
import { getEstimate } from "@/lib/data/estimates";
import { optionTotals, lineTotal } from "@/lib/estimate-calc";
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

  const options = estimate.options ?? [];
  const detailed = estimate.presentation === "detailed";
  const canRespond =
    estimate.status === "sent" || estimate.status === "changes_requested";
  const totalsFor = (o: EstimateOption) =>
    optionTotals(o.line_items ?? [], estimate.tax_rate);

  return (
    <div>
      <Link
        href="/portal"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {estimate.title || "Estimate"}
        </h1>
        <EstimateStatusBadge status={estimate.status} />
      </div>

      {estimate.job_description ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Scope of work</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {estimate.job_description}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        {options.map((option) => {
          const totals = totalsFor(option);
          const accepted = estimate.accepted_option_id === option.id;
          return (
            <Card
              key={option.id}
              className={accepted ? "ring-2 ring-green-500" : ""}
            >
              <CardHeader>
                <CardTitle className="text-base">
                  {option.name}
                  {accepted ? (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-green-600">
                      <Check className="size-3.5" /> Your choice
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {detailed ? (
                  <div className="divide-y text-sm">
                    {(option.line_items ?? []).map((l) => (
                      <div
                        key={l.id}
                        className="flex items-start justify-between gap-4 py-2"
                      >
                        <div>
                          {l.room ? `${l.room} — ` : ""}
                          {l.description || "Line item"}
                        </div>
                        <div className="shrink-0 font-medium">
                          {formatMoney(lineTotal(l))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="ml-auto mt-3 w-full max-w-xs space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatMoney(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax</span>
                    <span>{formatMoney(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold">
                    <span>Total</span>
                    <span>{formatMoney(totals.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
            <CardTitle className="text-base">Your decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              action={portalApproveEstimate}
              className="flex flex-wrap items-end gap-2"
            >
              <input type="hidden" name="estimate_id" value={estimate.id} />
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Choose your option
                </label>
                <select
                  name="accepted_option_id"
                  defaultValue={options[0]?.id}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {formatMoney(totalsFor(o).total)}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">
                <Check className="size-4" /> Approve estimate
              </Button>
            </form>

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
    </div>
  );
}

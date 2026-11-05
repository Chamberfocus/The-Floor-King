import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { listPortalEstimates } from "@/lib/data/portal-commercial";
import { optionTotals } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Your estimates" };

export default async function PortalEstimatesPage() {
  const profile = await requireProfile();
  if (!profile.customer_id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Your account isn&apos;t linked to a project yet.
        </CardContent>
      </Card>
    );
  }
  const estimates = await listPortalEstimates(profile.customer_id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Your estimate</h1>
        <p className="text-sm text-muted-foreground">
          Open one to review the price, approve it, or ask us to change it.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estimates</CardTitle>
        </CardHeader>
        <CardContent>
          {estimates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No estimate yet. It will show up here when we send it.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {estimates.map((e) => {
                const opts = e.options ?? [];
                const opt =
                  (e.accepted_option_id && opts.find((o) => o.id === e.accepted_option_id)) ||
                  opts[0];
                const total = opt ? optionTotals(opt.line_items ?? [], e.tax_rate).total : 0;
                const needsResponse = e.status === "sent" || e.status === "changes_requested";
                return (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                    <Link href={`/portal/estimates/${e.id}`} className="min-w-0 hover:underline">
                      <div className="truncate font-medium">{e.title || "Estimate"}</div>
                      {e.discussion_requested_at ? (
                        <div className="text-xs font-medium text-sky-700">
                          You asked to discuss this
                        </div>
                      ) : needsResponse ? (
                        <div className="text-xs font-medium text-blue-600">
                          Ready for you to review
                        </div>
                      ) : null}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3">
                      <EstimateStatusBadge status={e.status} />
                      <span className="font-medium">{formatMoney(total)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Wrench, Receipt, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import { JobStatusBadge } from "@/components/job-status-badge";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { requireProfile } from "@/lib/auth";
import { listEstimatesForCustomer } from "@/lib/data/estimates";
import { listJobsForCustomer } from "@/lib/data/jobs";
import { listInvoicesForCustomer, amountPaid } from "@/lib/data/invoices";
import { listClientThread } from "@/lib/data/messages";
import { portalSendMessage } from "./actions";
import { optionTotals } from "@/lib/estimate-calc";
import { invoiceTotals } from "@/lib/invoice-calc";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "My account" };

export default async function PortalHome() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] ?? "there";

  if (!profile.customer_id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Your account isn&apos;t linked to your project yet. Please contact us
          and we&apos;ll get you set up.
        </CardContent>
      </Card>
    );
  }

  const [estimates, jobs, invoices, thread] = await Promise.all([
    listEstimatesForCustomer(profile.customer_id),
    listJobsForCustomer(profile.customer_id),
    listInvoicesForCustomer(profile.customer_id),
    listClientThread(profile.customer_id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Your estimates, project schedule, and invoices in one place.
        </p>
      </div>

      {/* Messages */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4" /> Messages with us
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {thread.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Send us a note below — we&apos;re happy to help.
            </p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {thread.map((m) => (
                <div key={m.id}>
                  <div className="text-xs text-muted-foreground">
                    {m.author_id === profile.id ? "You" : "Cleveland Floor King"}{" "}
                    · {formatDateTime(m.created_at)}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                </div>
              ))}
            </div>
          )}
          <form
            action={portalSendMessage}
            className="space-y-2 border-t pt-3"
          >
            <textarea
              name="body"
              rows={2}
              required
              placeholder="Write a message…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit">Send</Button>
          </form>
        </CardContent>
      </Card>

      {/* Estimates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" /> Your estimates
          </CardTitle>
        </CardHeader>
        <CardContent>
          {estimates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No estimates yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {estimates.map((e) => {
                const opts = e.options ?? [];
                const opt =
                  (e.accepted_option_id &&
                    opts.find((o) => o.id === e.accepted_option_id)) ||
                  opts[0];
                const total = opt
                  ? optionTotals(opt.line_items ?? [], e.tax_rate).total
                  : 0;
                const needsResponse = e.status === "sent";
                return (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <Link
                      href={`/portal/estimates/${e.id}`}
                      className="min-w-0 hover:underline"
                    >
                      <div className="truncate font-medium">
                        {e.title || "Estimate"}
                      </div>
                      {needsResponse ? (
                        <div className="text-xs font-medium text-blue-600">
                          Action needed — review &amp; respond
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

      {/* Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="size-4" /> Your project schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing scheduled yet.
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {jobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <span className="font-medium">{j.title || "Job"}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <JobStatusBadge status={j.status} />
                    <span className="text-muted-foreground">
                      {j.scheduled_date
                        ? formatDate(j.scheduled_date)
                        : "To be scheduled"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" /> Your invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {invoices.map((inv) => {
                const t = invoiceTotals(
                  inv.items ?? [],
                  inv.tax_rate,
                  amountPaid(inv),
                );
                return (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <Link
                      href={`/portal/invoices/${inv.id}`}
                      className="font-medium hover:underline"
                    >
                      {inv.number || "Invoice"}
                    </Link>
                    <div className="flex shrink-0 items-center gap-3">
                      <InvoiceStatusBadge status={inv.status} />
                      <span className="font-medium">
                        {formatMoney(t.balance)} due
                      </span>
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

import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Wrench, Receipt, MessageSquare, ShoppingBag } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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
import {
  listPortalEstimates,
  listPortalJobs,
  listPortalInstallerNames,
} from "@/lib/data/portal-commercial";
import { listInvoicesForCustomer, invoiceDisplayTotals } from "@/lib/data/invoices";
import { listCustomerCheckouts } from "@/lib/data/samples";
import { listClientThread } from "@/lib/data/messages";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { portalSendMessage } from "./actions";
import { optionTotals } from "@/lib/estimate-calc";
import { formatDate, formatDateTime, formatMoney, to12 } from "@/lib/format";
import {
  getInstallAvailability,
  listInstallPreferences,
} from "@/lib/data/install-availability";
import { InstallPreferencePicker } from "./install-preference-picker";

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

  const [estimates, jobs, invoices, thread, sampleCheckouts] = await Promise.all([
    listPortalEstimates(profile.customer_id),
    listPortalJobs(profile.customer_id),
    listInvoicesForCustomer(profile.customer_id),
    listClientThread(profile.customer_id),
    listCustomerCheckouts(profile.customer_id),
  ]);
  const samplesOut = sampleCheckouts.filter((c) => c.status === "out");

  // Install scheduling: for active jobs with no confirmed date, load real
  // availability + any preferences the client already submitted. For confirmed
  // jobs, resolve the installer's name (they get to see it once we book it).
  const activeJobs = jobs.filter(
    (j) => j.status !== "completed" && j.status !== "cancelled",
  );
  const schedByJob = new Map<
    string,
    { days: number; availableStarts: string[]; existing: string[] }
  >();
  for (const j of activeJobs) {
    if (j.scheduled_date) continue;
    const avail = await getInstallAvailability(j.id);
    const existing = (await listInstallPreferences(j.id)).map((p) => p.preferred_date);
    schedByJob.set(j.id, {
      days: avail?.days ?? 0,
      availableStarts: avail?.availableStarts ?? [],
      existing,
    });
  }
  const installerNameByJobId = profile.customer_id
    ? await listPortalInstallerNames(profile.customer_id, activeJobs)
    : new Map<string, string>();

  return (
    <div className="space-y-6">
      <RealtimeRefresh
        table="messages"
        filter={`customer_id=eq.${profile.customer_id}`}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            Welcome, {firstName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Your estimates, project schedule, and invoices in one place.
          </p>
        </div>
        <Link href="/portal/order" className={buttonVariants({ size: "lg" })}>
          <ShoppingBag className="size-4" /> Place an order
        </Link>
      </div>

      {/* Samples you have out */}
      {samplesOut.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Samples to return</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {samplesOut.map((c) => (
              <div key={c.id} className="rounded-md border p-3 text-sm">
                <div className="font-medium">
                  Please return by{" "}
                  {new Date(`${c.due_date}T12:00:00`).toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {c.items.map((i) => (
                    <li key={i.id}>
                      {i.qty > 1 ? `${i.qty}× ` : ""}
                      {i.label}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

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
            <ul className="divide-y">
              {jobs.map((j) => {
                const sched = schedByJob.get(j.id);
                const window = j.arrival_window
                  ? j.arrival_window
                      .split("-")
                      .map((t) => to12(t.trim()))
                      .join("–")
                  : null;
                const installer = installerNameByJobId.get(j.id) ?? null;
                return (
                  <li key={j.id} className="space-y-3 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{j.title || "Your installation"}</span>
                      <JobStatusBadge status={j.status} />
                    </div>

                    {j.scheduled_date ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm dark:border-emerald-900/50 dark:bg-emerald-950/20">
                        <div className="font-semibold text-emerald-800 dark:text-emerald-300">
                          ✓ Confirmed installation
                        </div>
                        <div className="mt-0.5">
                          <span className="font-medium">{formatDate(j.scheduled_date)}</span>
                          {window ? ` · arriving ${window}` : ""}
                          {installer ? ` · with ${installer}` : ""}
                        </div>
                      </div>
                    ) : sched ? (
                      <InstallPreferencePicker
                        jobId={j.id}
                        days={sched.days}
                        availableStarts={sched.availableStarts}
                        existing={sched.existing}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">To be scheduled.</p>
                    )}
                  </li>
                );
              })}
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
                const t = invoiceDisplayTotals(inv);
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

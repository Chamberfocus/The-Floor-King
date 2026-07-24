import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Printer, Eye, HardHat, CheckCircle2 } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { getBillJobContext, getInstallerBill } from "@/lib/data/installer-bills";
import { laborBillLinesFromScope } from "@/lib/installer-bill";
import { buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { INSTALLER_BILL_STATUS_LABELS } from "@/lib/types";
import { AutoPrint } from "@/components/auto-print";
import { BillEditor } from "./bill-editor";
import { BillPrintDoc } from "./bill-print";
import { createBillFromWorkOrder, markInstallerBillPaid } from "./actions";

export const metadata: Metadata = { title: "Installer bill" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-emerald-500/10 text-emerald-600",
  paid: "bg-primary/10 text-primary",
};

export default async function InstallerBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string; preview?: string }>;
}) {
  const profile = await requireProfile();
  // Installer pay is internal — staff only (matches the job_labor / bills RLS).
  if (!["admin", "office"].includes(profile.role)) redirect("/");

  const { id } = await params;
  const sp = await searchParams;
  const print = sp.print === "1";
  const preview = sp.preview === "1";

  const ctx = await getBillJobContext(id);
  if (!ctx) notFound();
  const existing = await getInstallerBill(id);

  // No bill yet → offer to generate it from the work order labor scope.
  if (!existing) {
    const scopeLines = laborBillLinesFromScope(ctx.laborScope);
    return (
      <div className="mx-auto max-w-3xl">
        <Link
          href={`/jobs/${id}`}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to work order
        </Link>
        <div className="rounded-lg border bg-card p-8 text-center shadow-sm">
          <HardHat className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-bold">Installer bill</h1>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {scopeLines.length
              ? `Generate the bill from this job's work order labor scope (${scopeLines.length} line${scopeLines.length === 1 ? "" : "s"}). You can then adjust it against what the installer actually bills.`
              : "This job's work order has no labor scope. You can still create an empty bill and add lines by hand."}
          </p>
          <form action={createBillFromWorkOrder} className="mt-5">
            <input type="hidden" name="job_id" value={id} />
            <SubmitButton pendingText="Generating…">
              <CheckCircle2 className="size-4" /> Create installer bill
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  const { bill, lines } = existing;
  const org = await getOrgSettings();
  const dateLabel = formatDate(bill.approved_at ?? bill.created_at);

  // Print / preview: render ONLY the installer-facing doc (cost lines only —
  // no estimated, variance, reasons, material, or margin are passed in).
  if (print || preview) {
    return (
      <div className={preview ? "" : ""}>
        {print ? <AutoPrint /> : null}
        <BillPrintDoc
          org={org}
          installerName={ctx.installerName}
          address={ctx.address}
          dateLabel={dateLabel}
          lines={lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            rate: l.rate,
            line_total: l.line_total,
          }))}
          total={bill.total}
          preview={preview}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href={`/jobs/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to work order
      </Link>

      {/* Header */}
      <div className="mb-6 rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">
                {ctx.customerName ?? "Installer bill"}
              </h1>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
                  STATUS_BADGE[bill.status],
                )}
              >
                {INSTALLER_BILL_STATUS_LABELS[bill.status]}
              </span>
            </div>
            <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
              {ctx.address ? <div>{ctx.address}</div> : null}
              <div>
                Installer:{" "}
                <span className="font-medium text-foreground">
                  {ctx.installerName ?? "Unassigned"}
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bill total
            </div>
            <div className="text-2xl font-bold tabular-nums">{formatMoney(bill.total)}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <Link
            href={`/jobs/${id}/bill?preview=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <Eye className="size-4" /> Preview
          </Link>
          <Link
            href={`/jobs/${id}/bill?print=1`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            <Printer className="size-4" /> Print for installer
          </Link>
          {bill.status === "approved" ? (
            <form action={markInstallerBillPaid} className="ml-auto">
              <input type="hidden" name="bill_id" value={bill.id} />
              <input type="hidden" name="job_id" value={id} />
              <SubmitButton size="sm" pendingText="Saving…" confirm="Marked paid">
                Mark paid
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>

      <BillEditor
        billId={bill.id}
        jobId={id}
        status={bill.status}
        estimatedLaborCost={ctx.estimatedLaborCost}
        initialLines={lines}
        initialAdjustments={bill.adjustments}
        initialNotes={bill.notes}
      />
    </div>
  );
}

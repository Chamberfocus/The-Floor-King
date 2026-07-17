"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, Save, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { CustomerScopeView } from "@/components/customer-scope-view";
import { EstimateOptionCards } from "@/components/estimate-option-cards";
import { buildCustomerScope } from "@/lib/customer-scope";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import { docRef } from "@/lib/format";
import { formatMoney, formatDate } from "@/lib/format";
import type { Customer, Estimate, OrgSettings } from "@/lib/types";
import { saveEstimateNotes, setEstimatePresentation } from "../actions";

/**
 * Per-estimate toggle for whether the customer copy shows the detailed scope of
 * work or a simpler materials + price version. Presentation only — the price and
 * the firewall are identical either way.
 */
export function ScopeDetailToggle({
  estimateId,
  detailed,
}: {
  estimateId: string;
  detailed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (next: "detailed" | "summary") =>
    start(async () => {
      await setEstimatePresentation(estimateId, next);
      router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <ListChecks className="size-4 text-muted-foreground" /> Detailed scope of work
      </span>
      <div className="inline-flex rounded-md border p-0.5 text-sm">
        <button
          type="button"
          disabled={pending}
          onClick={() => set("detailed")}
          className={cn("rounded px-3 py-1 font-medium", detailed ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
        >
          On
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => set("summary")}
          className={cn("rounded px-3 py-1 font-medium", !detailed ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
        >
          Off
        </button>
      </div>
      <span className="text-xs text-muted-foreground">
        {detailed
          ? "Customer sees the full scope of work."
          : "Customer sees materials + price only."}
      </span>
    </div>
  );
}

/** Opens the print dialog automatically (used after "Create & print"). */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}

/** Print / save-as-PDF button (opens the browser print dialog). */
export function PrintEstimateButton() {
  return (
    <Button type="button" variant="outline" size="lg" onClick={() => window.print()}>
      <Printer className="size-4" /> Print / Download PDF
    </Button>
  );
}

/** Editable notes shown on the estimate and its printed copy. */
export function EstimateNotesEditor({
  estimateId,
  notes,
}: {
  estimateId: string;
  notes: string | null;
}) {
  const [value, setValue] = useState(notes ?? "");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", estimateId);
      fd.set("notes", value);
      await saveEstimateNotes(fd);
      toast.success("Notes saved");
    });
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="Notes for the customer — shown on the estimate and the printed/PDF copy (e.g. timeline, what's included, special terms)."
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          <Save className="size-3.5" /> {pending ? "Saving…" : "Save notes"}
        </Button>
      </div>
    </div>
  );
}

/**
 * The professional, print-only estimate. Shows the customer the FULL scope —
 * every room, product, and piece of work — for a single LUMP-SUM price, with no
 * square footage, linear footage, quantities, or unit pricing. The staff copy on
 * the same page keeps the numbers; only this printed copy hides them.
 */
export function EstimatePrintDoc({
  org,
  customer,
  estimate,
  preparedBy,
}: {
  org: OrgSettings;
  customer: Customer | null;
  estimate: Estimate;
  preparedBy?: string | null;
}) {
  const options = estimate.options ?? [];
  // Multiple options with no choice made yet → present them side by side so the
  // customer can compare. Once one is accepted (or there's only one), collapse to
  // that single scope + price.
  const showComparison = options.length > 1 && !estimate.accepted_option_id;
  const chosen =
    options.find((o) => o.id === estimate.accepted_option_id) ?? options[0] ?? null;
  const lines = chosen?.line_items ?? [];
  const totals = optionTotalsWithDiscount(
    lines,
    estimate.tax_rate,
    estimate.discount_kind,
    estimate.discount_value,
  );
  const scope = buildCustomerScope(lines, estimate.notes);
  const variant = estimate.presentation === "summary" ? "condensed" : "full";
  const number = docRef("EST", estimate.id);

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="ESTIMATE"
        meta={
          <>
            <div className="text-sm font-medium">{number}</div>
            {estimate.title ? <div className="text-xs">{estimate.title}</div> : null}
            <div className="text-xs">Date {formatDate(estimate.created_at)}</div>
            {estimate.valid_until ? (
              <div className="text-xs">Valid until {formatDate(estimate.valid_until)}</div>
            ) : null}
            {preparedBy ? <div className="text-xs">Estimator {preparedBy}</div> : null}
          </>
        }
      />

      {customer ? (
        <PrintBillTo
          label="Prepared for"
          name={customer.full_name}
          street={customer.street}
          city={customer.city}
          state={customer.state}
          zip={customer.zip}
          phone={customer.phone}
          email={customer.email}
        />
      ) : null}

      {showComparison ? (
        <div className="mt-4 border-t pt-5">
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            Your options — choose the one that fits
          </div>
          {estimate.job_description ? (
            <p className="mb-4 whitespace-pre-wrap text-[15px] leading-relaxed">
              {estimate.job_description}
            </p>
          ) : null}
          <EstimateOptionCards estimate={estimate} printMode />
          <p className="mt-4 text-[13px] leading-relaxed text-gray-600">
            Each option is a single, all-inclusive price — materials,
            professional installation, and site preparation as described.
            Applicable tax included. Approve the option you&apos;d like online,
            or let us know.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 border-t pt-5">
            <div className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              Your project
            </div>
            <CustomerScopeView
              scope={scope}
              variant={variant}
              narrative={estimate.job_description}
            />
          </div>

          <div className="mt-8 break-inside-avoid rounded-xl border-2 border-gray-800 px-5 py-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-base font-bold uppercase tracking-wide">
                Project total
              </span>
              <span className="text-3xl font-extrabold tabular-nums">
                {formatMoney(totals.total)}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
              A single, all-inclusive price for the complete project described
              above — materials, professional installation, and site
              preparation. Applicable tax included.
            </p>
          </div>
        </>
      )}

      <div className="mt-8 border-t pt-3 text-center text-xs text-gray-500">
        Thank you for the opportunity to earn your business. — {org.company_name}
      </div>
    </div>
  );
}

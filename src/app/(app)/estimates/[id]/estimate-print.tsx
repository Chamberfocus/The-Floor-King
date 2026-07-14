"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { CustomerScopeView } from "@/components/customer-scope-view";
import { buildCustomerScope } from "@/lib/customer-scope";
import { optionTotalsWithDiscount } from "@/lib/estimate-calc";
import { docRef } from "@/lib/format";
import { formatMoney, formatDate } from "@/lib/format";
import type { Customer, Estimate, OrgSettings } from "@/lib/types";
import { saveEstimateNotes } from "../actions";

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
  // One combined scope + one price. When several options exist, the customer's
  // copy shows the one they accepted, or the first if none is chosen yet.
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

      <div className="mt-2 border-t pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Your project
        </div>
        <CustomerScopeView
          scope={scope}
          variant={variant}
          narrative={estimate.job_description}
        />
      </div>

      <div className="mt-6 break-inside-avoid border-t-2 border-gray-800 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold uppercase tracking-wide">
            Project total
          </span>
          <span className="text-2xl font-bold tabular-nums">
            {formatMoney(totals.total)}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-600">
          A single, all-inclusive price for the complete project described above —
          materials, labor, and site preparation. Applicable tax included.
        </p>
      </div>

      <div className="mt-8 border-t pt-3 text-center text-xs text-gray-500">
        Thank you for the opportunity to earn your business. — {org.company_name}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { optionTotalsWithDiscount, lineTotal, lineQty } from "@/lib/estimate-calc";
import { formatMoney, formatDate } from "@/lib/format";
import type {
  Customer,
  EstimateLineItem,
  EstimateOption,
  OrgSettings,
} from "@/lib/types";
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

function lineLabel(l: EstimateLineItem): string {
  return [l.room, l.description || "Line item"].filter(Boolean).join(" — ");
}
function lineQtyText(l: EstimateLineItem): string {
  if (l.line_type === "flat") return "";
  const unit = (l.unit && l.unit.trim()) || (l.measure_unit === "sqyd" ? "sq yd" : "sq ft");
  return `${lineQty(l).toFixed(2)} ${unit}`;
}

/** The professional, print-only estimate document (logo, contact, lines, notes). */
export function EstimatePrintDoc({
  org,
  customer,
  estimate,
}: {
  org: OrgSettings;
  customer: Customer | null;
  estimate: {
    title: string | null;
    created_at: string;
    valid_until: string | null;
    tax_rate: number;
    discount_kind: "amount" | "percent";
    discount_value: number;
    presentation: string;
    job_description: string | null;
    notes: string | null;
    options?: EstimateOption[];
  };
}) {
  const detailed = estimate.presentation === "detailed";
  const options = estimate.options ?? [];

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="ESTIMATE"
        meta={
          <>
            {estimate.title ? <div className="text-sm font-medium">{estimate.title}</div> : null}
            <div className="text-xs">Date {formatDate(estimate.created_at)}</div>
            {estimate.valid_until ? (
              <div className="text-xs">Valid until {formatDate(estimate.valid_until)}</div>
            ) : null}
          </>
        }
      />

      {customer ? (
        <PrintBillTo
          name={customer.full_name}
          street={customer.street}
          city={customer.city}
          state={customer.state}
          zip={customer.zip}
          phone={customer.phone}
          email={customer.email}
        />
      ) : null}

      {estimate.job_description ? (
        <p className="whitespace-pre-wrap py-2 text-sm">{estimate.job_description}</p>
      ) : null}

      {options.map((o) => {
        const totals = optionTotalsWithDiscount(
          o.line_items ?? [],
          estimate.tax_rate,
          estimate.discount_kind,
          estimate.discount_value,
        );
        return (
          <div key={o.id} className="mt-4 break-inside-avoid">
            {options.length > 1 ? (
              <div className="mb-1 text-sm font-semibold">{o.name}</div>
            ) : null}
            {detailed ? (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] text-gray-500">
                    <th className="py-1 pr-2 font-medium">Description</th>
                    <th className="py-1 px-2 text-right font-medium">Qty</th>
                    <th className="py-1 pl-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(o.line_items ?? []).map((l) => (
                    <tr key={l.id} className="border-b align-top">
                      <td className="py-1 pr-2">
                        {lineLabel(l)}
                        {l.from_stock ? <span className="text-gray-500"> (from stock)</span> : null}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums text-gray-600">{lineQtyText(l)}</td>
                      <td className="py-1 pl-2 text-right tabular-nums">{formatMoney(lineTotal(l))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-gray-700">Complete flooring project as quoted.</p>
            )}
            <div className="ml-auto mt-2 w-56 text-sm">
              {detailed ? (
                <>
                  <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span>{formatMoney(totals.subtotal)}</span></div>
                  {totals.discount > 0 ? (
                    <div className="flex justify-between"><span className="text-gray-600">Discount</span><span>−{formatMoney(totals.discount)}</span></div>
                  ) : null}
                  <div className="flex justify-between"><span className="text-gray-600">Tax ({estimate.tax_rate}%)</span><span>{formatMoney(totals.tax)}</span></div>
                </>
              ) : null}
              <div className="flex justify-between border-t pt-1 text-base font-bold">
                <span>{options.length > 1 ? `${o.name} total` : "Total"}</span>
                <span>{formatMoney(totals.total)}</span>
              </div>
            </div>
          </div>
        );
      })}

      {estimate.notes ? (
        <div className="mt-6 break-inside-avoid text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Notes</div>
          <p className="whitespace-pre-wrap">{estimate.notes}</p>
        </div>
      ) : null}

      <div className="mt-8 border-t pt-3 text-center text-xs text-gray-500">
        Thank you for the opportunity to earn your business. — {org.company_name}
      </div>
    </div>
  );
}

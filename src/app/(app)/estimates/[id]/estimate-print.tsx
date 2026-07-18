"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, Save, ListChecks, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PrintLetterhead, PrintBillTo } from "@/components/print-letterhead";
import { CustomerScopeView } from "@/components/customer-scope-view";
import { EstimateOptionCards } from "@/components/estimate-option-cards";
import { buildCustomerScope, parseProjectDetails, customerLineLabel } from "@/lib/customer-scope";
import { optionTotalsWithDiscount, lineTotal } from "@/lib/estimate-calc";
import { docRef } from "@/lib/format";
import { formatMoney, formatDate } from "@/lib/format";
import type { Customer, Estimate, OrgSettings } from "@/lib/types";
import { saveEstimateNotes, setEstimatePresentation, setEstimateProjectDetails } from "../actions";

function Seg({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded px-3 py-1 font-medium",
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Two independent per-estimate switches for the customer copy:
 *  • Itemized (a price on each line) vs Lump sum (one total).
 *  • Whether the captured questionnaire answers (Project details) appear.
 * Presentation only — the underlying totals and the firewall on quantities /
 * unit costs / margins never change.
 */
export function EstimateCustomerControls({
  estimateId,
  presentation,
  showProjectDetails,
}: {
  estimateId: string;
  presentation: string;
  showProjectDetails: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const itemized = presentation !== "summary";
  const setPres = (v: string) =>
    start(async () => {
      await setEstimatePresentation(estimateId, v === "summary" ? "summary" : "detailed");
      router.refresh();
    });
  const setPD = (v: string) =>
    start(async () => {
      await setEstimateProjectDetails(estimateId, v === "on");
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Receipt className="size-4 text-muted-foreground" /> Customer sees
        </span>
        <Seg
          value={itemized ? "detailed" : "summary"}
          disabled={pending}
          onChange={setPres}
          options={[
            { value: "detailed", label: "Itemized" },
            { value: "summary", label: "Lump sum" },
          ]}
        />
        <span className="text-xs text-muted-foreground">
          {itemized ? "A price on each line." : "One all-inclusive total."}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <ListChecks className="size-4 text-muted-foreground" /> Project details
        </span>
        <Seg
          value={showProjectDetails ? "on" : "off"}
          disabled={pending}
          onChange={setPD}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
        />
      </div>
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
  // Two independent switches, both firewall-safe (no sq ft / quantities / unit
  // costs / margins): "itemized" prices each line vs one lump sum; project
  // details shows the captured questionnaire answers.
  const itemized = estimate.presentation !== "summary";
  const projectDetails = estimate.show_project_details
    ? parseProjectDetails(estimate.job_description).details
    : [];
  const number = docRef("EST", estimate.id);

  // Itemized breakdown: each priced line, grouped by room, showing its LINE
  // TOTAL only (never a quantity, unit cost, sq ft, or margin).
  const itemGroups: { room: string; items: { label: string; note: string; amount: number }[] }[] = [];
  if (itemized) {
    const at = new Map<string, number>();
    for (const l of lines) {
      const amount = lineTotal(l);
      if (!(amount > 0)) continue; // skip zero / placeholder lines
      const room = (l.room ?? "").trim() || "Project";
      if (!at.has(room)) {
        at.set(room, itemGroups.length);
        itemGroups.push({ room, items: [] });
      }
      itemGroups[at.get(room)!].items.push({ label: customerLineLabel(l), note: (l.note ?? "").trim(), amount });
    }
  }

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="ESTIMATE"
        meta={
          <>
            <div className="text-base font-bold">{number}</div>
            {estimate.title ? <div className="text-sm text-gray-700">{estimate.title}</div> : null}
            <div className="text-sm text-gray-700">Date {formatDate(estimate.created_at)}</div>
            {estimate.valid_until ? (
              <div className="text-sm text-gray-700">Valid until {formatDate(estimate.valid_until)}</div>
            ) : null}
            {preparedBy ? <div className="text-sm text-gray-700">Estimator {preparedBy}</div> : null}
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
          <div className="mt-3 border-t pt-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              Your project
            </div>

            {itemized ? (
              // ITEMIZED — a price on each line, grouped by room. Each product
              // is its own line with its price; line totals only (never a
              // quantity, unit cost, sq ft, or margin).
              <div className="space-y-3">
                {itemGroups.map((g) => (
                  <div key={g.room} className="break-inside-avoid">
                    <h3 className="text-base font-bold">{g.room}</h3>
                    <ul className="mt-1 divide-y divide-gray-200">
                      {g.items.map((it, i) => (
                        <li key={i} className="flex items-baseline justify-between gap-4 py-1 text-[15px]">
                          <span>
                            {it.label}
                            {it.note ? (
                              <span className="mt-0.5 block text-[13px] leading-snug text-gray-600">{it.note}</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums">{formatMoney(it.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              // LUMP SUM — materials featured, then the scope in words.
              <CustomerScopeView scope={scope} variant="full" narrative={estimate.notes} />
            )}
          </div>

          {projectDetails.length > 0 ? (
            <div className="mt-4 break-inside-avoid border-t pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                Project details
              </div>
              <ul className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm leading-snug sm:grid-cols-2">
                {projectDetails.map((d, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-40" />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5 break-inside-avoid rounded-xl border-2 border-gray-800 px-5 py-3">
            {itemized && (totals.discount > 0 || totals.tax > 0) ? (
              <div className="mb-2 space-y-1 border-b border-gray-300 pb-2 text-[15px]">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
                </div>
                {totals.discount > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Discount</span>
                    <span className="tabular-nums">−{formatMoney(totals.discount)}</span>
                  </div>
                ) : null}
                {totals.tax > 0 ? (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax</span>
                    <span className="tabular-nums">{formatMoney(totals.tax)}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-base font-bold uppercase tracking-wide">
                {itemized ? "Total" : "Project total"}
              </span>
              <span className="text-3xl font-extrabold tabular-nums">
                {formatMoney(totals.total)}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-snug text-gray-600">
              {itemized
                ? "All-inclusive — materials, professional installation, and site preparation as itemized above. Applicable tax included."
                : "A single, all-inclusive price for the complete project described above — materials, professional installation, and site preparation. Applicable tax included."}
            </p>
          </div>
        </>
      )}

      <div className="mt-5 border-t pt-2.5 text-center text-xs text-gray-500">
        Thank you for the opportunity to earn your business. — {org.company_name}
      </div>
    </div>
  );
}

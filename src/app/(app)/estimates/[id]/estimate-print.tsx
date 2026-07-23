"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, Save, ListChecks, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EstimateOptionCards } from "@/components/estimate-option-cards";
import { customerLineLabel } from "@/lib/customer-scope";
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
        rows={5}
        placeholder="Description — fills the body of the estimate. Describe the whole job in words: what's being installed and where, take-up & haul-away, matching stairnosing & transitions, toilet reset, undercuts, etc. Shown to the customer."
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          <Save className="size-3.5" /> {pending ? "Saving…" : "Save description"}
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
  preview = false,
}: {
  org: OrgSettings;
  customer: Customer | null;
  estimate: Estimate;
  preparedBy?: string | null;
  /** On-screen document preview: show the doc as a white sheet (not print-only). */
  preview?: boolean;
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
  // "Itemized" prices each line; otherwise one lump sum. Firewall-safe either way
  // (no sq ft / quantities / unit costs / margins / carpet cuts).
  const itemized = estimate.presentation !== "summary";
  const number = docRef("EST", estimate.id);

  // Body content (customer-facing): the AREAS being done and a free-text
  // DESCRIPTION of the job (the estimate notes). No cuts, quantities, or costs.
  const areas = [...new Set(lines.map((l) => (l.room ?? "").trim()).filter(Boolean))];
  const description = (estimate.notes ?? "").trim();
  // Headline material for the lump row — the priciest non-labor line.
  const primary = lines
    .filter((l) => l.category !== "labor" && lineTotal(l) > 0)
    .sort((a, b) => lineTotal(b) - lineTotal(a))[0];
  const primaryLabel = primary
    ? customerLineLabel(primary)
    : estimate.title || "Flooring — materials & installation";
  const taxLabel =
    Number(estimate.tax_rate) > 0 ? `Tax (${estimate.tax_rate}%)` : "Tax (Non-taxable 0%)";
  const custAddr = customer
    ? [customer.street, [customer.city, customer.state].filter(Boolean).join(", "), customer.zip]
        .filter(Boolean)
        .join(", ")
    : "";
  const custContact = customer
    ? [customer.phone, customer.email].filter(Boolean).join("   ·   ")
    : "";
  const website = org.website
    ? org.website.startsWith("http")
      ? org.website
      : `http://www.${org.website.replace(/^www\./, "")}`
    : "";
  const pricedLines = itemized ? lines.filter((l) => lineTotal(l) > 0) : [];

  return (
    <div
      className={cn(
        "text-black print:block",
        preview
          ? "mx-auto max-w-4xl bg-white p-6 shadow-sm ring-1 ring-black/10 sm:p-10"
          : "hidden",
      )}
      style={{ fontFamily: '"Helvetica Neue", Arial, sans-serif' }}
    >
      {/* Header — logo left, summary box right */}
      <div className="flex items-start justify-between gap-6">
        <div>
          {org.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt={org.company_name} className="h-24 w-auto max-w-[320px] object-contain" />
          ) : (
            <div className="text-3xl font-extrabold tracking-tight">{org.company_name}</div>
          )}
        </div>
        <div className="w-[320px] shrink-0 border border-gray-400 text-[13px]">
          <div className="flex justify-between px-3 py-1.5">
            <span className="text-gray-700">ESTIMATE</span>
            <span className="font-semibold">#{number}</span>
          </div>
          <div className="flex justify-between px-3 py-1.5">
            <span className="text-gray-700">ESTIMATE DATE</span>
            <span className="font-semibold">{formatDate(estimate.created_at)}</span>
          </div>
          <div className="flex justify-between border-t border-gray-400 px-3 py-2">
            <span className="font-bold">TOTAL</span>
            <span className="text-[15px] font-bold tabular-nums">{formatMoney(totals.total)}</span>
          </div>
        </div>
      </div>

      {/* Prepared for — the prominent customer block; Contact Us alongside */}
      {customer ? (
        <div className="mt-6 flex items-start justify-between gap-10 border-l-4 border-[#b51a00] bg-[#faf6f5] px-4 py-3.5">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#b51a00]">Prepared for</div>
            <div className="text-2xl font-extrabold leading-tight">{customer.full_name}</div>
            {custAddr ? <div className="mt-1 text-[15px] text-gray-700">{custAddr}</div> : null}
            {custContact ? <div className="mt-2 text-[15px] text-gray-700">{custContact}</div> : null}
          </div>
          <div className="shrink-0 text-right text-[13px] text-gray-700">
            <div className="mb-1.5 border-b border-gray-300 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Contact Us
            </div>
            {org.address ? <div className="whitespace-pre-line">{org.address}</div> : null}
            {org.phone ? <div className="mt-2">{org.phone}</div> : null}
            {org.email ? <div>{org.email}</div> : null}
          </div>
        </div>
      ) : null}

      {showComparison ? (
        <div className="mt-6 border-t pt-5">
          <div className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            Your options — choose the one that fits
          </div>
          {estimate.job_description ? (
            <p className="mb-4 whitespace-pre-wrap text-[15px] leading-relaxed">{estimate.job_description}</p>
          ) : null}
          <EstimateOptionCards estimate={estimate} printMode />
          <p className="mt-4 text-[13px] leading-relaxed text-gray-600">
            Each option is a single, all-inclusive price — materials, professional installation, and site
            preparation as described. Applicable tax included. Approve the option you&apos;d like online, or let
            us know.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-7 text-[17px] tracking-wide">ESTIMATE</div>
          <div className="text-xl font-bold">{chosen?.name || "Option #1"}</div>

          {/* Materials / scope table */}
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="bg-[#8a9099] text-[13px] font-semibold text-white">
                <th className="px-3 py-1.5 text-left">Materials</th>
                <th className="px-3 py-1.5 text-right">qty</th>
                <th className="px-3 py-1.5 text-right">unit price</th>
                <th className="px-3 py-1.5 text-right">amount</th>
              </tr>
            </thead>
            <tbody>
              {itemized ? (
                pricedLines.map((l, i) => {
                  const amt = lineTotal(l);
                  return (
                    <tr key={i} className="border-b border-gray-200 align-top">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold">{customerLineLabel(l)}</div>
                        {l.room ? <div className="mt-0.5 text-[13px] text-gray-500">{l.room}</div> : null}
                        {(l.note ?? "").trim() ? (
                          <div className="mt-1 text-[13px] leading-snug text-gray-600">{l.note}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">1.0</td>
                      <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">{formatMoney(amt)}</td>
                      <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-700">{formatMoney(amt)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr className="border-b border-gray-200 align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold">{primaryLabel}</div>
                    {areas.length ? (
                      <div className="mt-1.5 text-[14px]">
                        <span className="font-semibold">Areas:</span> {areas.join(", ")}
                      </div>
                    ) : null}
                    {description ? (
                      <div className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-gray-700">
                        {description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">1.0</td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-600">{formatMoney(totals.subtotal)}</td>
                  <td className="px-3 py-2.5 text-right text-[13px] tabular-nums text-gray-700">{formatMoney(totals.subtotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-2 text-right text-[13px] text-gray-700">
            Materials subtotal: {formatMoney(totals.subtotal)}
          </div>

          {/* Itemized still surfaces areas + description below the priced lines. */}
          {itemized && (areas.length > 0 || description) ? (
            <div className="mt-4 break-inside-avoid border-t pt-3 text-[13.5px] leading-relaxed text-gray-700">
              {areas.length ? (
                <div className="text-[14px]"><span className="font-semibold">Areas:</span> {areas.join(", ")}</div>
              ) : null}
              {description ? <div className="mt-2 whitespace-pre-wrap">{description}</div> : null}
            </div>
          ) : null}

          {/* Totals */}
          <div className="ml-auto mt-8 w-[46%] break-inside-avoid">
            <div className="flex justify-between border-b border-gray-300 py-2 text-[14px]">
              <span className="text-gray-700">Subtotal</span>
              <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
            </div>
            {totals.discount > 0 ? (
              <div className="flex justify-between border-b border-gray-300 py-2 text-[14px]">
                <span className="text-gray-700">Discount</span>
                <span className="tabular-nums">−{formatMoney(totals.discount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-b border-gray-300 py-2 text-[14px]">
              <span className="text-gray-700">{taxLabel}</span>
              <span className="tabular-nums">{formatMoney(totals.tax)}</span>
            </div>
            <div className="flex items-baseline justify-between pt-3.5">
              <span className="text-[22px] font-bold">Total</span>
              <span className="text-[26px] font-extrabold tabular-nums">{formatMoney(totals.total)}</span>
            </div>
          </div>

          {/* Closing notes */}
          <div className="mt-11 break-inside-avoid text-[13.5px] leading-relaxed text-gray-800">
            <p>
              We thank you for the opportunity and appreciate the trust! Please look over the information and let
              me know if you have any questions at all.
            </p>
            <p className="mt-2.5">
              Please be advised that there is an automatic 3.5% credit card surcharge on all credit card
              purchases, no exceptions — we encourage you to pay by check or cash.
            </p>
            <div className="mt-5">
              <p className="mb-0.5">Thank you,</p>
              <p>{preparedBy || org.company_name}</p>
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="mt-10 flex items-center justify-between border-t border-gray-300 pt-2 text-xs text-gray-500">
        <span>{org.company_name}</span>
        {website ? <span>{website}</span> : <span />}
        <span>1 of 1</span>
      </div>
    </div>
  );
}

import { PrintLetterhead } from "@/components/print-letterhead";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OrgSettings } from "@/lib/types";

export interface BillPrintLine {
  description: string;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  line_total: number;
}

/**
 * Installer-facing bill (print / PDF). Deliberately shows ONLY what the installer
 * needs to see: business info, their name, the job address, the date, the labor
 * line items, and the total. It never renders estimated_labor_cost,
 * labor_variance, change_reason, material costs, margins, or any customer
 * pricing — none of those are even passed in.
 */
export function BillPrintDoc({
  org,
  installerName,
  address,
  dateLabel,
  lines,
  total,
  preview = false,
}: {
  org: OrgSettings;
  installerName: string | null;
  address: string;
  dateLabel: string;
  lines: BillPrintLine[];
  total: number;
  /** On-screen document preview: show as a white sheet, not print-only. */
  preview?: boolean;
}) {
  return (
    <div
      className={cn(
        "text-black print:block",
        preview
          ? "mx-auto max-w-4xl bg-white p-6 shadow-sm ring-1 ring-black/10 sm:p-10"
          : "hidden",
      )}
    >
      <PrintLetterhead
        org={org}
        docTitle="INSTALLER BILL"
        meta={
          <>
            {installerName ? (
              <div className="text-sm font-medium">{installerName}</div>
            ) : null}
            <div className="text-xs">{dateLabel}</div>
          </>
        }
      />

      {address ? (
        <div className="py-3 text-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Job site:{" "}
          </span>
          <span>{address}</span>
        </div>
      ) : null}

      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] text-gray-500">
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1 px-2 text-right font-medium">Qty</th>
            <th className="py-1 px-2 font-medium">Unit</th>
            <th className="py-1 px-2 text-right font-medium">Rate</th>
            <th className="py-1 pl-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.length ? (
            lines.map((l, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-1.5 pr-2">{l.description || "Labor"}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {l.quantity != null ? l.quantity : ""}
                </td>
                <td className="py-1.5 px-2 text-gray-600">{l.unit ?? ""}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {l.rate != null ? formatMoney(l.rate) : ""}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {formatMoney(l.line_total)}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5} className="py-3 text-center text-gray-500">
                No labor lines on this bill.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="ml-auto mt-2 w-56 text-sm">
        <div className="flex justify-between border-t pt-1 text-base font-bold">
          <span>Total due</span>
          <span className="tabular-nums">{formatMoney(total)}</span>
        </div>
      </div>

      <div className="mt-8 flex justify-between gap-8 text-sm">
        <div className="flex-1">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            Installer signature
          </div>
        </div>
        <div className="w-40">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">Date</div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-500">{org.company_name}</div>
    </div>
  );
}

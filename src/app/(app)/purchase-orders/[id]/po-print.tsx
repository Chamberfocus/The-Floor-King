import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate, formatMoney } from "@/lib/format";
import {
  PO_STATUS_LABELS,
  PO_SOURCE_LABELS,
  type Customer,
  type OrgSettings,
  type PoItem,
  type PurchaseOrder,
} from "@/lib/types";

function itemLabel(it: PoItem): string {
  const spec = [it.manufacturer, it.style, it.color].filter(Boolean).join(" / ");
  const base = it.description || spec || "Item";
  const extra = [it.description && spec ? spec : "", it.item_no ? `#${it.item_no}` : ""]
    .filter(Boolean)
    .join(" · ");
  return extra ? `${base} — ${extra}` : base;
}

/**
 * The print-only PURCHASE ORDER — letterhead, who we're ordering from, where it
 * ships, and the line items with costs and a total. This is what you hand or
 * send to the vendor.
 */
export function PoPrintDoc({
  org,
  customer,
  po,
}: {
  org: OrgSettings;
  customer: Customer | null;
  po: PurchaseOrder;
}) {
  const items = po.items ?? [];
  const total = items.reduce(
    (s, it) => s + (it.quantity ?? 0) * (it.unit_cost ?? 0),
    0,
  );

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="PURCHASE ORDER"
        meta={
          <>
            <div className="text-xs">Date {formatDate(po.created_at)}</div>
            {po.eta_date ? (
              <div className="text-xs">ETA {formatDate(po.eta_date)}</div>
            ) : null}
            <div className="text-xs">
              Status: {PO_STATUS_LABELS[po.status]}
              {po.source_type ? ` · ${PO_SOURCE_LABELS[po.source_type]}` : ""}
            </div>
          </>
        }
      />

      <div className="flex flex-wrap justify-between gap-6 py-4 text-sm">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Order from
          </div>
          <div className="font-medium">{po.supplier || "Vendor"}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Ship to
          </div>
          <div className="font-medium">{org.company_name}</div>
          {org.address ? (
            <div className="whitespace-pre-line text-xs text-gray-600">
              {org.address}
            </div>
          ) : null}
          {customer ? (
            <div className="mt-1 text-xs text-gray-600">
              For job: {customer.full_name}
            </div>
          ) : null}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-[11px] text-gray-500">
            <th className="py-1 pr-2 font-medium">Item</th>
            <th className="py-1 px-2 text-right font-medium">Qty</th>
            <th className="py-1 px-2 text-right font-medium">Unit cost</th>
            <th className="py-1 pl-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const amount = (it.quantity ?? 0) * (it.unit_cost ?? 0);
            return (
              <tr key={it.id} className="border-b align-top">
                <td className="py-1 pr-2">{itemLabel(it)}</td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-600">
                  {it.quantity ?? ""} {it.unit}
                </td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-600">
                  {it.unit_cost != null ? formatMoney(it.unit_cost) : ""}
                </td>
                <td className="py-1 pl-2 text-right tabular-nums">
                  {formatMoney(amount)}
                </td>
              </tr>
            );
          })}
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-3 text-center text-gray-500">
                No items on this purchase order.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <div className="ml-auto mt-2 w-56 text-sm">
        <div className="flex justify-between border-t pt-1 text-base font-bold">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>
      </div>

      {po.notes ? (
        <div className="mt-6 break-inside-avoid text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Notes
          </div>
          <p className="whitespace-pre-wrap">{po.notes}</p>
        </div>
      ) : null}

      <div className="mt-8 border-t pt-3 text-center text-xs text-gray-500">
        {org.company_name}
      </div>
    </div>
  );
}

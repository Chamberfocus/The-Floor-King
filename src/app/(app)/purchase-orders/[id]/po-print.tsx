import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate, formatMoney } from "@/lib/format";
import {
  PO_STATUS_LABELS,
  PO_SOURCE_LABELS,
  isHardSurfaceCategory,
  isRollGoodCategory,
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

/** Whether a PO line is hard surface / roll good — from the stored category,
 *  falling back to the unit-helper columns for older lines with no category. */
function poLineIsHard(it: PoItem): boolean {
  if (it.category) return isHardSurfaceCategory(it.category);
  return it.sqft_per_box != null && it.sqft_per_box > 0;
}
function poLineIsRoll(it: PoItem): boolean {
  if (it.category) return isRollGoodCategory(it.category);
  return (it.roll_width_ft != null && it.roll_width_ft > 0) ||
    (it.unit || "").toLowerCase().includes("yd");
}

/**
 * The print-only PURCHASE ORDER — vendor-ready and unit-correct. Hard surface is
 * ordered in CARTONS (with the sq-ft basis shown so the count is verifiable);
 * carpet/sheet vinyl is ordered by the square yard with the broadloom roll width.
 * A lot/dye-lot reminder prints on any hard-surface order.
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
  const hasHard = items.some(poLineIsHard);

  return (
    <div className="hidden text-black print:block">
      <PrintLetterhead
        org={org}
        docTitle="PURCHASE ORDER"
        meta={
          <>
            <div className="text-xs">Date {formatDate(po.created_at)}</div>
            {po.eta_date ? (
              <div className="text-xs font-medium">Needed by {formatDate(po.eta_date)}</div>
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
            <th className="py-1 px-2 text-right font-medium">Order qty</th>
            <th className="py-1 px-2 text-right font-medium">Unit cost</th>
            <th className="py-1 pl-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const qty = it.quantity ?? 0;
            const amount = qty * (it.unit_cost ?? 0);
            const isHard = poLineIsHard(it);
            const isRoll = poLineIsRoll(it);
            const spb = it.sqft_per_box ?? 0;
            // Hard surface: order in whole cartons; show the sq-ft basis so the
            // count is verifiable. Carpet: yards + broadloom roll width.
            const cartons = isHard && spb > 0 ? Math.ceil(qty / spb) : 0;
            const orderQty = cartons
              ? `${cartons} carton${cartons === 1 ? "" : "s"}`
              : `${Math.round(qty * 100) / 100} ${it.unit ?? ""}`.trim();
            const basis = cartons
              ? `${Math.round(qty * 100) / 100} sq ft ÷ ${spb}/box`
              : isHard
                ? "⚠ set sq ft/box for carton count"
                : isRoll && it.roll_width_ft
                  ? `${it.roll_width_ft} ft broadloom roll`
                  : "";
            return (
              <tr key={it.id} className="border-b align-top">
                <td className="py-1 pr-2">
                  {itemLabel(it)}
                  {basis ? (
                    <span className="block text-[11px] text-gray-500">{basis}</span>
                  ) : null}
                </td>
                <td className="py-1 px-2 text-right font-medium tabular-nums text-gray-700">
                  {orderQty}
                </td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-600">
                  {it.unit_cost != null ? `${formatMoney(it.unit_cost)}/${it.unit ?? ""}`.trim() : ""}
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

      {hasHard ? (
        <div className="mt-4 break-inside-avoid rounded border-2 border-black p-2 text-sm">
          <span className="font-semibold">⚠ Lot / dye lot:</span> confirm every
          carton ships from the <span className="font-semibold">same lot / dye lot</span>.
          Mixed lots show as color variation on the finished floor.
        </div>
      ) : null}

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

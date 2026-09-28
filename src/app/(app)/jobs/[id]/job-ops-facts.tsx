import type { ReactNode } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/format";
import { assessMaterialsReadyForSchedule } from "@/lib/materials-ready";
import { poAttentionFact, poEtaMissing, type PoReceiptLine } from "@/lib/po-facts";
import { formatPoNumber } from "@/lib/types";

export function JobOpsFacts({
  hasMaterialNeed,
  warehouseReadyAt,
  stagingLocation,
  openBalance,
  availableDeposit,
  pos,
  estimateId,
}: {
  hasMaterialNeed: boolean;
  warehouseReadyAt: string | null;
  stagingLocation: string | null;
  openBalance: number;
  availableDeposit: number;
  estimateId: string | null;
  pos: {
    id: string;
    po_number: string | number | null;
    supplier: string | null;
    eta_date: string | null;
    backordered: boolean | null;
    status: string | null;
    items?: PoReceiptLine[];
  }[];
}) {
  const materials = assessMaterialsReadyForSchedule({
    warehouseReadyAt,
    hasMaterialNeed,
  });
  const materialFact = !hasMaterialNeed
    ? "No material is required for scheduling."
    : materials.ready
      ? `Materials ready${stagingLocation ? ` · ${stagingLocation}` : ""}`
      : "Materials are not ready.";

  return (
    <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="Materials">{materialFact}</Fact>
      <Fact label="Warehouse ready">
        {warehouseReadyAt ? formatDate(warehouseReadyAt) : "Not confirmed"}
      </Fact>
      <Fact label="Customer balance">{formatMoney(openBalance)}</Fact>
      <Fact label="Available deposit">{formatMoney(availableDeposit)}</Fact>
      <div className="sm:col-span-2 lg:col-span-4">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Purchase orders
        </div>
        {pos.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {pos.map((p) => (
              <li key={p.id}>
                <Link href={`/purchase-orders/${p.id}`} className="text-primary hover:underline">
                  {p.po_number != null ? formatPoNumber(Number(p.po_number)) : "Draft PO"}
                  {p.supplier ? ` · ${p.supplier}` : ""}
                </Link>
                <span className="text-muted-foreground">
                  {" · "}
                  {poAttentionFact(p)}
                  {p.eta_date ? ` · ETA ${formatDate(p.eta_date)}` : ""}
                  {poEtaMissing(p) ? " · ETA not entered" : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {hasMaterialNeed
              ? "No purchase order on this job."
              : "No purchase order is required for scheduling."}
          </p>
        )}
        {hasMaterialNeed ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Each purchase order keeps its own arrival date. Received material stays separate from warehouse ready.
          </p>
        ) : null}
      </div>
      {estimateId ? (
        <div className="sm:col-span-2 lg:col-span-4 text-sm">
          Extra work or a return trip?{" "}
          <Link href={`/estimates/${estimateId}`} className="font-medium text-primary hover:underline">
            Update the estimate
          </Link>
          , then{" "}
          <Link
            href={`/estimates/${estimateId}/invoice`}
            className="font-medium text-primary hover:underline"
          >
            bill the approved change
          </Link>
          . Paid invoices stay locked.
        </div>
      ) : null}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

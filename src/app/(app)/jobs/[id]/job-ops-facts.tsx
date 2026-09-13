import type { ReactNode } from "react";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/format";

export function JobOpsFacts({
  warehouseReadyAt,
  stagingLocation,
  openBalance,
  availableDeposit,
  pos,
  estimateId,
}: {
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
  }[];
}) {
  const nextEta = pos
    .map((p) => p.eta_date)
    .filter((d): d is string => !!d)
    .sort()[0];
  const backordered = pos.some((p) => p.backordered);

  return (
    <div className="mb-4 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="Warehouse">
        {warehouseReadyAt
          ? `Ready${stagingLocation ? ` · ${stagingLocation}` : ""}`
          : "Not marked ready"}
      </Fact>
      <Fact label="Material ETA">
        {backordered ? (
          <span className="text-amber-700 dark:text-amber-300">Backordered</span>
        ) : nextEta ? (
          formatDate(nextEta)
        ) : pos.length ? (
          "No ETA on PO"
        ) : (
          "No PO yet"
        )}
      </Fact>
      <Fact label="Customer balance">{formatMoney(openBalance)}</Fact>
      <Fact label="Available deposit">{formatMoney(availableDeposit)}</Fact>
      {pos.length ? (
        <div className="sm:col-span-2 lg:col-span-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Purchase orders
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {pos.map((p) => (
              <li key={p.id}>
                <Link href={`/purchase-orders/${p.id}`} className="text-primary hover:underline">
                  PO {p.po_number ?? ""} {p.supplier ? `· ${p.supplier}` : ""}
                </Link>
                <span className="text-muted-foreground">
                  {p.eta_date ? ` · ETA ${formatDate(p.eta_date)}` : ""}
                  {p.backordered ? " · backorder" : ""}
                  {p.status ? ` · ${p.status}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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

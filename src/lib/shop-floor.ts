/** Shop-day helpers for the morning sheet, claims, and the tax packet. */

export function shopDatePlus(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  const base = new Date(Date.UTC(y, m - 1, d, 12));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export type PickLine = {
  location: string | null;
  rollNumber: string | null;
  productName: string;
};

function binKey(location: string | null): string {
  const value = location?.trim() || "";
  return value || "\uffff";
}

/** Bin, then roll number, so the morning pull walks the warehouse in order. */
export function sortPickLines<T extends PickLine>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const loc = binKey(a.location).localeCompare(binKey(b.location), undefined, { numeric: true });
    if (loc) return loc;
    const roll = (a.rollNumber || "").localeCompare(b.rollNumber || "", undefined, { numeric: true });
    if (roll) return roll;
    return a.productName.localeCompare(b.productName);
  });
}

export type SalesSlice = {
  subtotal: number;
  tax: number;
  claim: boolean;
};

export type SalesSplit = {
  sales: number;
  salesTax: number;
  claimSales: number;
  claimTax: number;
};

/** Claims stay out of sales. Their tax is still listed, because it was charged. */
export function splitSales(rows: readonly SalesSlice[]): SalesSplit {
  const out: SalesSplit = { sales: 0, salesTax: 0, claimSales: 0, claimTax: 0 };
  for (const row of rows) {
    const subtotal = Number(row.subtotal) || 0;
    const tax = Number(row.tax) || 0;
    if (row.claim) {
      out.claimSales += subtotal;
      out.claimTax += tax;
    } else {
      out.sales += subtotal;
      out.salesTax += tax;
    }
  }
  return out;
}

/** More installs than active crews means the day is over the shop's crew count. */
export function dayIsOverCapacity(jobs: number, crews: number): boolean {
  return crews > 0 && jobs > crews;
}

export type RoomSketch = {
  name: string;
  lengthIn: number;
  widthIn: number;
};

export function roomSketches(
  lines: readonly { room: string | null; lengthIn: number | null; widthIn: number | null }[],
): RoomSketch[] {
  const rooms: RoomSketch[] = [];
  for (const line of lines) {
    const lengthIn = Number(line.lengthIn) || 0;
    const widthIn = Number(line.widthIn) || 0;
    if (lengthIn <= 0 || widthIn <= 0) continue;
    rooms.push({
      name: line.room?.trim() || "Room",
      lengthIn,
      widthIn,
    });
  }
  return rooms;
}

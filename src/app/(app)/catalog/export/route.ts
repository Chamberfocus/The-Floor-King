import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { listProducts } from "@/lib/data/products";
import { reorderAlertsFor } from "@/lib/data/stock-rolls";

export const dynamic = "force-dynamic";

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download the whole catalog as CSV (edit in Excel, re-import via the mapper). */
export async function GET() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const products = await listProducts();
  let remnantAlerts: Awaited<ReturnType<typeof reorderAlertsFor>> = {};
  try {
    remnantAlerts = await reorderAlertsFor(products.map((p) => p.id));
  } catch {
    remnantAlerts = {};
  }
  const headers = [
    "name",
    "category",
    "manufacturer",
    "style",
    "color",
    "sku",
    "unit",
    "material_rate",
    "labor_rate",
    "on_hand",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const p of products) {
    const remnantItems = remnantAlerts[p.id]?.items ?? [];
    // Exclusive carpet-tile catalog export leftover planted on-hand mixed-product SUM is not the order — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
    // Hard-surface catalog export leftover planted on-hand mixed-product SUM stays How many, not leftover taped sq ft as an order. Wrap / count How many stays. Do not invent coverage.
    const remnantUnits = remnantItems.map((i) => (i.unit || "").trim());
    const mixedRemnant = new Set(remnantUnits).size > 1;
    const onHandCell = mixedRemnant ? (remnantItems.length > 1 ? `stock across ${remnantItems.length} pieces` : "stock as a remnant/roll") : p.on_hand;
    lines.push(
      [
        p.name,
        p.category,
        p.manufacturer,
        p.style,
        p.color,
        p.sku,
        p.unit,
        p.material_rate,
        p.labor_rate,
        onHandCell,
        p.notes,
      ]
        .map(cell)
        .join(","),
    );
  }
  const csv = lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv;charset=utf-8",
      "content-disposition": `attachment; filename="floor-king-catalog.csv"`,
    },
  });
}

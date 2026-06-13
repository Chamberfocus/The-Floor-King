import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { listProducts } from "@/lib/data/products";

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
        p.on_hand,
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

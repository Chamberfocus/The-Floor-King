import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { QuickInvoiceForm } from "./quick-invoice-form";
import type { QuickProduct } from "@/components/quick-lines";

export const metadata: Metadata = { title: "Counter sale" };
export const dynamic = "force-dynamic";

export default async function QuickInvoicePage() {
  await requireRole(["admin", "office", "sales_manager", "salesman"]);
  const supabase = await createClient();

  const [{ data: custData }, { data: prodData }, { data: lastInv }, { data: lastEst }] =
    await Promise.all([
    supabase
      .from("customers")
      .select("id, full_name")
      .order("full_name", { ascending: true })
      .limit(2000),
    supabase
      .from("products")
      .select(
        "id, name, unit, material_rate, manufacturer, style, color, on_hand, track_stock, clearance, clearance_price",
      )
      .eq("active", true)
      .order("name", { ascending: true })
      .limit(2000),
      // There is no org-wide tax setting — it lives per document. Default to the
      // last rate actually used so the counter isn't retyping it every sale.
      supabase
        .from("invoices")
        .select("tax_rate")
        .not("tax_rate", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("estimates")
        .select("tax_rate")
        .not("tax_rate", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const defaultTaxRate =
    Number(lastInv?.tax_rate ?? 0) || Number(lastEst?.tax_rate ?? 0) || 0;

  const customers = (custData ?? []).map((c) => ({
    id: c.id as string,
    full_name: (c.full_name as string) ?? "Unnamed",
  }));

  const products: QuickProduct[] = (prodData ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? "",
    unit: (p.unit as string) ?? "each",
    // Clearance price wins where one is set — that's the price on the shelf.
    rate: Number(
      (p.clearance && p.clearance_price != null
        ? p.clearance_price
        : p.material_rate) ?? 0,
    ),
    manufacturer: (p.manufacturer as string) ?? null,
    style: (p.style as string) ?? null,
    color: (p.color as string) ?? null,
    on_hand: Number(p.on_hand ?? 0),
    track_stock: Boolean(p.track_stock),
  }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/invoices"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to invoices
      </Link>
      <PageHeader
        title="Counter sale"
        description="Cash & carry — they're taking it with them. Customer, what they took, what they paid, done. No estimate and no job: the invoice IS the paperwork."
      />
      <QuickInvoiceForm
        customers={customers}
        products={products}
        defaultTaxRate={defaultTaxRate}
      />
    </div>
  );
}

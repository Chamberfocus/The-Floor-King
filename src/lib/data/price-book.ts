import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buyerPriceRow, type BuyerPriceRow } from "@/lib/buyer-price";
import type { ProductVendor } from "@/lib/types";

export type PriceBookAccount = {
  profileId: string;
  marginPct: number;
  active: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
};

type AccessRow = {
  profile_id: string;
  margin_pct: number | string;
  active: boolean;
};

function adminOrNull() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/** The signed-in person's price-book account, including one that is turned off. */
export async function priceBookGate(
  profileId: string,
): Promise<{ marginPct: number; active: boolean } | null> {
  const admin = adminOrNull();
  if (!admin || !profileId) return null;
  const { data } = await admin
    .from("price_book_access")
    .select("margin_pct, active")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!data) return null;
  const margin = Number(data.margin_pct);
  if (!Number.isFinite(margin)) return null;
  return { marginPct: margin, active: data.active === true };
}

export async function listPriceBookAccounts(): Promise<PriceBookAccount[]> {
  const admin = adminOrNull();
  if (!admin) return [];
  const { data } = await admin
    .from("price_book_access")
    .select("profile_id, margin_pct, active")
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as AccessRow[];
  if (!rows.length) return [];
  const { data: people } = await admin
    .from("profiles")
    .select("id, full_name, email, phone")
    .in(
      "id",
      rows.map((row) => row.profile_id),
    );
  const byId = new Map(
    ((people ?? []) as { id: string; full_name: string | null; email: string | null; phone: string | null }[]).map(
      (person) => [person.id, person],
    ),
  );
  return rows.map((row) => {
    const person = byId.get(row.profile_id);
    return {
      profileId: row.profile_id,
      marginPct: Number(row.margin_pct),
      active: row.active === true,
      name: person?.full_name ?? null,
      email: person?.email ?? null,
      phone: person?.phone ?? null,
    };
  });
}

type ProductRow = {
  id: string;
  name: string | null;
  category: string | null;
  unit: string | null;
  sku: string | null;
  manufacturer: string | null;
  style: string | null;
  color: string | null;
  material_rate: number | null;
  labor_rate: number | null;
  active: boolean | null;
};

const PAGE = 1000;

/** Sell prices for one active price-book login. Cost never leaves this function. */
export async function loadBuyerPrices(profileId: string): Promise<BuyerPriceRow[] | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  const gate = await priceBookGate(profileId);
  if (!gate?.active) return null;

  const products: ProductRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("products")
      .select("id, name, category, unit, sku, manufacturer, style, color, material_rate, labor_rate, active")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return null;
    const batch = (data ?? []) as ProductRow[];
    products.push(...batch);
    if (batch.length < PAGE) break;
  }

  const vendorsByProduct = new Map<string, ProductVendor[]>();
  const ids = products.map((product) => product.id);
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("product_vendors")
        .select("product_id, cost, position")
        .in("product_id", chunk)
        .order("product_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return null;
      const batch = (data ?? []) as {
        product_id: string;
        cost: number | null;
        position: number | null;
      }[];
      for (const vendor of batch) {
        const list = vendorsByProduct.get(vendor.product_id) ?? [];
        list.push({
          id: "",
          product_id: vendor.product_id,
          vendor_id: "",
          cost: vendor.cost,
          vendor_sku: null,
          position: vendor.position ?? 0,
        });
        vendorsByProduct.set(vendor.product_id, list);
      }
      if (batch.length < PAGE) break;
    }
  }

  const orgRes = await admin
    .from("org_settings")
    .select("freight_markup_pct")
    .eq("id", "default")
    .maybeSingle();
  if (orgRes.error) return null;
  const freight = Number(orgRes.data?.freight_markup_pct) || 0;

  const rows: BuyerPriceRow[] = [];
  for (const product of products) {
    if (product.active === false || product.category === "labor") continue;
    const priced = buyerPriceRow(
      { ...product, vendors: vendorsByProduct.get(product.id) ?? [] },
      gate.marginPct,
      freight,
    );
    if (priced) rows.push(priced);
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

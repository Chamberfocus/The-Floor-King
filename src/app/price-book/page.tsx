import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { loadBuyerPrices, priceBookGate } from "@/lib/data/price-book";
import { BuyerPriceList } from "./price-list";

export const metadata: Metadata = { title: "Price book" };

export default async function PriceBookPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await requireProfile();
  const gate = await priceBookGate(profile.id);
  if (!gate?.active) {
    return (
      <p className="text-sm text-muted-foreground">
        This price book login is turned off. Ask the shop to turn it back on.
      </p>
    );
  }
  const query = ((await searchParams).q ?? "").trim().slice(0, 80);
  const rows = query ? await loadBuyerPrices(profile.id, query) : [];
  return <BuyerPriceList rows={rows} query={query} />;
}

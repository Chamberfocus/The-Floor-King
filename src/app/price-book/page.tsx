import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { loadBuyerPrices, priceBookGate } from "@/lib/data/price-book";
import { BuyerPriceList } from "./price-list";

export const metadata: Metadata = { title: "Price book" };

export default async function PriceBookPage() {
  const profile = await requireProfile();
  const gate = await priceBookGate(profile.id);
  if (!gate?.active) {
    return (
      <p className="text-sm text-muted-foreground">
        This price book login is turned off. Ask the shop to turn it back on.
      </p>
    );
  }
  const rows = await loadBuyerPrices(profile.id);
  if (!rows) {
    return (
      <p className="text-sm text-muted-foreground">
        The price book could not be loaded. Ask the shop to check the login.
      </p>
    );
  }
  return <BuyerPriceList rows={rows} />;
}

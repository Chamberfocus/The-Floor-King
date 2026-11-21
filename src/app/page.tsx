import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { priceBookGate } from "@/lib/data/price-book";
import { homeHrefForRole } from "@/lib/nav";

// The root route sends people to the right place based on auth + role.
export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "customer") {
    const priceBook = await priceBookGate(profile.id);
    redirect(priceBook ? "/price-book" : "/portal");
  }
  if (profile.role === "warehouse") redirect("/warehouse");
  if (profile.role === "crew") redirect("/installer");
  redirect(homeHrefForRole(profile.role));
}

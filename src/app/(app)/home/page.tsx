import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { loadHomeCenter } from "@/lib/data/home-center";
import { loadHomePeople } from "@/lib/data/home-people";
import { HomeCenterView } from "@/components/home-center-view";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] || "there";
  const [board, people] = await Promise.all([
    loadHomeCenter({
      role: profile.role,
      userId: profile.id,
      firstName,
    }),
    loadHomePeople({ role: profile.role, userId: profile.id }),
  ]);
  const customersHref = [
    "admin",
    "office",
    "sales_manager",
    "salesman",
    "scheduler",
  ].includes(profile.role)
    ? "/customers"
    : null;
  return <HomeCenterView board={board} people={people} customersHref={customersHref} />;
}

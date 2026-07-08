import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

// The root route sends people to the right place based on auth + role.
export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role === "customer") redirect("/portal");
  if (profile.role === "warehouse") redirect("/warehouse");
  if (profile.role === "crew") redirect("/installer");
  if (profile.role === "scheduler") redirect("/jobs");
  // Customer-centric: staff land on the customer list, not a summary screen.
  redirect("/customers");
}

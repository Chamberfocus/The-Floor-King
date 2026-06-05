import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";

// The root route sends people to the right place based on auth + role.
export const dynamic = "force-dynamic";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(profile.role === "customer" ? "/portal" : "/dashboard");
}

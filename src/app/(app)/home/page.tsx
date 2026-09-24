import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { loadHomeCenter } from "@/lib/data/home-center";
import { HomeCenterView } from "@/components/home-center-view";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] || "there";
  const center = await loadHomeCenter({
    role: profile.role,
    userId: profile.id,
    firstName,
  });
  return <HomeCenterView center={center} />;
}

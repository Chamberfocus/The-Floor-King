import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth";
import { loadHomeCenter } from "@/lib/data/home-center";
import { loadSaleFocusBoard } from "@/lib/data/sale-focus";
import { HomeCenterView } from "@/components/home-center-view";
import { SaleFocusHome } from "@/components/sale-focus-home";
import { readSaleFocusCookie } from "@/lib/sale-focus";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const profile = await requireProfile();
  const firstName = profile.full_name?.split(" ")[0] || "there";
  if (profile.role === "salesman") {
    const pinned = readSaleFocusCookie(await cookies());
    const board = await loadSaleFocusBoard({
      userId: profile.id,
      firstName,
      pinnedId: pinned?.id ?? null,
    });
    return <SaleFocusHome board={board} />;
  }
  const board = await loadHomeCenter({
    role: profile.role,
    userId: profile.id,
    firstName,
  });
  return <HomeCenterView board={board} />;
}

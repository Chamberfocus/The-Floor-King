import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { getRoomDefaults, getAddonDefaults } from "@/lib/data/addon-defaults";
import { DefaultPricing } from "./default-pricing";

export const metadata: Metadata = { title: "Default pricing" };
export const dynamic = "force-dynamic";

export default async function DefaultPricingPage() {
  await requireRole(["admin", "office", "sales_manager"]);
  const roomDefaults = await getRoomDefaults();
  const addonDefaults = await getAddonDefaults();

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Default pricing"
        description="Your usual rates by flooring type, plus add-on & pad prices. These pre-fill in the smart estimate builder — change them here anytime."
      />
      <DefaultPricing roomDefaults={roomDefaults} addonDefaults={addonDefaults} />
    </div>
  );
}

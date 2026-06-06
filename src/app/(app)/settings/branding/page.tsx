import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { BrandingForm } from "./branding-form";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const org = await getOrgSettings();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Branding"
        description="Your logo, color, and contact details — shown across the app, the customer portal, and documents."
      />
      <BrandingForm org={org} />
    </div>
  );
}

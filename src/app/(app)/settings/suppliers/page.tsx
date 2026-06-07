import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { listSuppliers } from "@/lib/data/suppliers";
import { PricingForm } from "./pricing-form";
import { SupplierList } from "./supplier-list";

export const metadata: Metadata = { title: "Freight & suppliers" };

export default async function SuppliersSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const [org, suppliers] = await Promise.all([
    getOrgSettings(),
    listSuppliers(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Freight, fuel & quote terms"
        description="Cover yourself: add freight per supplier and a global fuel surcharge that bakes into your cost automatically, and set how long quotes stay valid."
      />
      <PricingForm org={org} />
      <SupplierList suppliers={suppliers} />
    </div>
  );
}

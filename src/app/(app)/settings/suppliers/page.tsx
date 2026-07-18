import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getOrgSettings } from "@/lib/data/org";
import { listSuppliers } from "@/lib/data/suppliers";
import { getPoCounter } from "@/lib/data/purchase-orders";
import { PricingForm } from "./pricing-form";
import { SupplierList } from "./supplier-list";
import { PoNumberingForm } from "./po-numbering-form";

export const metadata: Metadata = { title: "Vendors, freight & PO numbering" };

export default async function SuppliersSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const [org, suppliers, counter] = await Promise.all([
    getOrgSettings(),
    listSuppliers(),
    getPoCounter(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="Vendors, freight & PO numbering"
        description="Manage your vendor records, set freight and the global fuel surcharge, choose your purchase-order starting number, and set how long estimates stay valid."
      />
      <SupplierList suppliers={suppliers} />
      <PoNumberingForm nextNumber={counter.nextNumber} maxIssued={counter.maxIssued} />
      <PricingForm org={org} />
    </div>
  );
}

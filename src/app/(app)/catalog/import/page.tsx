import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listSuppliers } from "@/lib/data/suppliers";
import { SmartImporter } from "../smart-importer";

export const metadata: Metadata = { title: "Import price list" };
// Allow long AI reads for scanned PDFs (Vercel caps this to your plan's max —
// 60s on Hobby, up to 300s on Pro).
export const maxDuration = 300;

export default async function ImportPriceListPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");
  const suppliers = (await listSuppliers()).map((s) => s.name);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/catalog"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to catalog
      </Link>
      <PageHeader
        title="Import price list"
        description="Drop a price list in any format — Excel, CSV, PDF, or a photo. We read it, you review, then import. Re-importing a list can update prices instead of making duplicates."
      />

      <Card>
        <CardContent className="pt-6">
          <SmartImporter suppliers={suppliers} />
        </CardContent>
      </Card>
    </div>
  );
}

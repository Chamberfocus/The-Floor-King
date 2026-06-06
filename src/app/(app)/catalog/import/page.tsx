import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { PriceListImporter } from "../price-list-importer";

export const metadata: Metadata = { title: "Import price list" };

export default async function ImportPriceListPage() {
  const profile = await requireProfile();
  if (!["admin", "office", "sales_manager"].includes(profile.role)) redirect("/");

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
        description="Paste a vendor price list (any format) or upload a PDF/image. AI parses it into products — review, tweak, and import."
      />
      <Card>
        <CardContent className="pt-6">
          <PriceListImporter />
        </CardContent>
      </Card>
    </div>
  );
}

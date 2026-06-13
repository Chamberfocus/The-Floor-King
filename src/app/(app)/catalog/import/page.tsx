import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Zap, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { PriceListImporter } from "../price-list-importer";
import { MappingImporter } from "../mapping-importer";

export const metadata: Metadata = { title: "Import price list" };
export const maxDuration = 60;

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
        description="Excel or CSV imports instantly — just match the columns. PDFs and pasted text use AI."
      />

      <Card className="mb-6 border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="size-4 text-primary" />
            Excel / CSV — instant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MappingImporter />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-muted-foreground" />
            PDF, image, or pasted text — AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PriceListImporter />
        </CardContent>
      </Card>
    </div>
  );
}

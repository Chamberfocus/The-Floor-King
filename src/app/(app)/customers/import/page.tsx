import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Zap, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { ClientImporter } from "../client-importer";
import { CustomerMappingImporter } from "../customer-mapping-importer";

export const metadata: Metadata = { title: "Import clients" };
export const maxDuration = 60;

export default async function ImportClientsPage() {
  const profile = await requireProfile();
  const allowed = ["admin", "office", "sales_manager"];
  if (!allowed.includes(profile.role)) redirect("/");

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to customers
      </Link>
      <PageHeader
        title="Import clients"
        description="Paste your existing customer list (any format) or upload a file. Review everything, then import. This only adds new customers — it never changes or deletes what's already here."
      />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="size-4 text-primary" /> Excel / CSV — instant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CustomerMappingImporter />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" /> PDF, image, or pasted text — AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ClientImporter />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { ClientImporter } from "../client-importer";

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
      <Card>
        <CardContent className="pt-6">
          <ClientImporter />
        </CardContent>
      </Card>
    </div>
  );
}

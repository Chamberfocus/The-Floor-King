import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CustomerForm } from "../customers/customer-form";
import { listLeadSources } from "@/lib/data/lead-sources";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Add customer" };

/**
 * Production-safe customer creation route kept outside the /customers nested
 * layout. The existing /customers area currently has a production-only server
 * render failure; this route preserves the proven CustomerForm/createCustomer
 * workflow without depending on that failing nested layout.
 */
export default async function NewCustomerPage() {
  await requireRole(["admin", "office", "sales_manager", "salesman", "scheduler"]);
  const sources = await listLeadSources({ activeOnly: true });

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/home"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to home
      </Link>
      <PageHeader
        title="Add customer"
        description="Create a new lead or customer. Only a name is required — fill in the rest as you learn it."
      />
      <Card>
        <CardContent className="pt-6">
          <CustomerForm sources={sources} />
        </CardContent>
      </Card>
    </div>
  );
}

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
 * Customer creation intentionally lives outside the /customers nested layout.
 * This keeps the core create flow available even if the customer-list module has
 * a production-only render/data problem. The mutation itself still enforces its
 * server-action role checks and RLS; this page also keeps the normal staff guard.
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

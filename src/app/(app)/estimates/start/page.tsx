import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { listCustomers } from "@/lib/data/customers";
import { StartEstimate } from "../start-estimate";

export const metadata: Metadata = { title: "New estimate" };

export default async function StartEstimatePage() {
  const customers = await listCustomers();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/estimates"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to estimates
      </Link>
      <PageHeader
        title="New estimate"
        description="Pick the customer, then build it with the Wizard or a Quick estimate."
      />
      <Card>
        <CardContent className="pt-6">
          <StartEstimate
            customers={customers.map((c) => ({
              id: c.id,
              full_name: c.full_name,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

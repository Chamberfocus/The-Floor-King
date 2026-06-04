import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Add customer" };

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to customers
      </Link>
      <PageHeader
        title="Add customer"
        description="Create a new lead or customer. Only a name is required — fill in the rest as you learn it."
      />
      <Card>
        <CardContent className="pt-6">
          <CustomerForm />
        </CardContent>
      </Card>
    </div>
  );
}

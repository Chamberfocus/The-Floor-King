import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { FullSafeCustomerForm } from "./full-safe-customer-form";

export const metadata: Metadata = { title: "Add customer" };

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/home"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to home
        </Link>
        <Link
          href="/customer-records"
          className="text-sm font-medium text-primary hover:underline"
        >
          Manage customer records
        </Link>
      </div>

      <PageHeader
        title="Add customer"
        description="Create a complete customer record with source, stage, address, notes, and duplicate protection."
      />

      <Card>
        <CardContent className="pt-6">
          <FullSafeCustomerForm />
        </CardContent>
      </Card>
    </div>
  );
}

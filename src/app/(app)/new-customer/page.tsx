import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listHandoffMembers } from "@/lib/data/workflow";
import { canAssignLead, canOwnSalesLead } from "@/lib/lead-intake";
import { FullSafeCustomerForm } from "./full-safe-customer-form";

export const metadata: Metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const profile = await requireProfile();
  const assignees = canAssignLead(profile.role)
    ? (await listHandoffMembers())
        .filter((member) => canOwnSalesLead(member.role))
        .map((member) => ({ id: member.id, name: member.name }))
    : [];
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
        description="Create the customer, assign the salesperson, and book the estimate visit on this form. A name and a source are required."
      />

      <Card>
        <CardContent className="pt-6">
          <FullSafeCustomerForm assignees={assignees} />
        </CardContent>
      </Card>
    </div>
  );
}

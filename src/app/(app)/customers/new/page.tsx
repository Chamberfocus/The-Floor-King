import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listHandoffMembers } from "@/lib/data/workflow";
import { listLeadSources } from "@/lib/data/lead-sources";
import { seesEveryLead } from "@/lib/lead-acceptance";
import { NewCustomerForm } from "../new-customer-form";

export const metadata: Metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const profile = await requireProfile();
  const sources = await listLeadSources({ activeOnly: true });
  const assignees = seesEveryLead(profile.role)
    ? (await listHandoffMembers())
        .filter((m) => m.role === "salesman" || m.role === "sales_manager")
        .map((m) => ({ id: m.id, name: m.name }))
    : [];
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
        description="Paste a Facebook or website lead, or type the customer in. A name and a source are required."
      />
      <NewCustomerForm sources={sources} assignees={assignees} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { BillImporter } from "../bill-importer";

export const metadata: Metadata = { title: "Import bill" };

export default async function ImportBillPage() {
  const profile = await requireProfile();
  if (!["admin", "office"].includes(profile.role)) redirect("/");
  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/bills"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to bills
      </Link>
      <PageHeader
        title="Import a bill"
        description="Drop a vendor bill or invoice and we'll read it into a bill — you confirm before it saves."
      />
      <BillImporter />
    </div>
  );
}

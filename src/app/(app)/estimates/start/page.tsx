import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { listLeadSources } from "@/lib/data/lead-sources";
import { StartEstimate } from "../start-estimate";

export const metadata: Metadata = { title: "New estimate" };

export default async function StartEstimatePage() {
  const sources = await listLeadSources();

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
        description="Find the customer, then start it — guided questionnaire, straight into the builder, or a copy of what you quoted them before."
      />
      <Card>
        <CardContent className="pt-6">
          <StartEstimate sources={sources} />
        </CardContent>
      </Card>
    </div>
  );
}

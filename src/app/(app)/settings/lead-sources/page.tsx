import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listLeadSources, listLeadSourceSpend } from "@/lib/data/lead-sources";
import { LeadSourceManager } from "./lead-source-manager";

export const metadata: Metadata = { title: "Lead sources & ad spend" };
export const dynamic = "force-dynamic";

export default async function LeadSourcesSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const [sources, spend] = await Promise.all([listLeadSources(), listLeadSourceSpend()]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Settings
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Lead sources & ad spend"
          description="The list your team picks from when recording how a customer heard about you — plus the monthly ad spend that powers cost-per-lead and return-on-ad-spend in the report."
        />
        <Button render={<Link href="/reports/lead-sources" />} variant="outline" size="sm">
          <BarChart3 className="size-4" /> View report
        </Button>
      </div>

      {sources.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No sources yet. If you just added the feature, paste migration{" "}
          <code className="font-mono">0112_lead_sources.sql</code> in Supabase, then reload — the
          starter list (Google, Facebook, Referral…) seeds automatically. You can also add your
          own below.
        </div>
      ) : null}

      <LeadSourceManager sources={sources} spend={spend} />
    </div>
  );
}

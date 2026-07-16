import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { TargetsForm } from "./targets-form";

export const metadata: Metadata = { title: "Profit targets" };

export default async function TargetsSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const settings = await getBusinessSettings();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Profit targets"
        description="What good looks like. Business Pulse measures your jobs and months against these."
      />
      <Card>
        <CardContent className="pt-6">
          <TargetsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getUserPreferences } from "@/lib/data/preferences";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "My page setup" };

export default async function PreferencesSettingsPage() {
  // Personal to every logged-in user — no role gate.
  await requireProfile();
  const prefs = await getUserPreferences();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="My page setup"
        description="Personal to your login — set up the customer pages the way that works best for you. Only you see these."
      />
      <Card>
        <CardContent className="pt-6">
          <PreferencesForm prefs={prefs} />
        </CardContent>
      </Card>
    </div>
  );
}

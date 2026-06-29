import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireProfile } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { saveSampleSettings } from "./actions";

export const metadata: Metadata = { title: "Samples settings" };
export const dynamic = "force-dynamic";

export default async function SampleSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin" && profile.role !== "office") redirect("/");
  const s = await getBusinessSettings();

  async function save(formData: FormData) {
    "use server";
    await saveSampleSettings(formData);
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Samples"
        description="Defaults for the sample checkout & return flow."
      />
      <Card>
        <CardContent className="pt-6">
          <form action={save} className="space-y-4">
            <Field
              label="Loan period (days)"
              hint="The default return-by window when you check out samples."
            >
              <Input name="loan_days" type="number" min="1" defaultValue={s.sample_loan_days} className="w-28" />
            </Field>
            <Field
              label="Remind this many days before due"
              hint="Return reminders (text + email) start this many days before the due date, then repeat every 2 days while due/overdue."
            >
              <Input name="lead_days" type="number" min="0" defaultValue={s.sample_reminder_lead_days} className="w-28" />
            </Field>
            <Field
              label="Default deposit / hold ($)"
              hint="Pre-fills the deposit at checkout (0 = none). You can change it per checkout."
            >
              <Input name="deposit" inputMode="decimal" defaultValue={s.sample_default_deposit || ""} placeholder="0" className="w-28" />
            </Field>
            <Field
              label="Max samples out per customer"
              hint="Block a checkout that would exceed this. 0 = no limit."
            >
              <Input name="max_out" type="number" min="0" defaultValue={s.sample_max_out} className="w-28" />
            </Field>
            <div className="flex justify-end">
              <SubmitButton pendingText="Saving…" confirm="Saved">
                Save
              </SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4 last:border-0 last:pb-0">
      <div className="max-w-xs">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  );
}

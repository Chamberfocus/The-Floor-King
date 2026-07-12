import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BellRing, Users, User } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { setNotifyFlag } from "./actions";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

function Toggle({
  field,
  on,
  onLabel,
  offLabel,
}: {
  field: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <form action={setNotifyFlag}>
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="on" value={on ? "false" : "true"} />
      <Button type="submit" size="sm" variant={on ? "default" : "outline"}>
        {on ? onLabel : offLabel}
      </Button>
    </form>
  );
}

export default async function NotificationsSettingsPage() {
  const me = await requireProfile();
  if (me.role !== "admin") redirect("/");
  const s = await getBusinessSettings();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <PageHeader
        title="Notifications"
        description="Master switches for the texts and emails the app sends. These decide who actually receives anything — the gate runs on every message, so nothing slips through."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" /> Staff, installers, sales &amp; warehouse
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">
            Texts &amp; emails to your <strong>team</strong> — installer schedule
            changes, job assignments, warehouse hand-offs, time-off approvals, and
            daily/owner reports.
          </p>
          <Toggle
            field="notify_staff"
            on={s.notify_staff}
            onLabel="On"
            offLabel="Off — turn on"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="size-4 text-primary" /> Customers
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">
            Texts &amp; emails to <strong>customers</strong> — appointment and
            install confirmations, &ldquo;on the way,&rdquo; reschedules, estimates,
            and invoices. Leave this <strong>off</strong> until you&apos;re ready;
            staff messages keep flowing regardless.
          </p>
          <Toggle
            field="notify_customers"
            on={s.notify_customers}
            onLabel="On"
            offLabel="Off (recommended for now)"
          />
        </CardContent>
      </Card>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <BellRing className="size-3.5" /> Nothing is sent to anyone until your
        Twilio (texts) and Resend (emails) keys are set in the environment.
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  Users,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getUserPreferences } from "@/lib/data/preferences";
import {
  getMyGoogleStatus,
  getTeamCalendar,
  listMyCalendars,
} from "@/lib/data/google-calendar";
import { googleConfigured } from "@/lib/google-calendar";
import { PreferencesForm } from "./preferences-form";
import {
  disconnectGoogleCalendar,
  setTeamCalendar,
  createTeamCalendar,
  unsetTeamCalendar,
} from "./actions";

export const metadata: Metadata = { title: "My page setup" };

// Roles that book appointments — only they see the Google Calendar card.
const CALENDAR_ROLES = [
  "admin",
  "office",
  "sales_manager",
  "salesman",
  "scheduler",
];

const GCAL_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Calendar connected." },
  denied: { ok: false, text: "Google connection was cancelled." },
  state: { ok: false, text: "Security check failed — please try connecting again." },
  error: { ok: false, text: "Couldn't complete the connection. Try again." },
  notconfigured: {
    ok: false,
    text: "Google Calendar isn't set up on the server yet (admin: add the OAuth env vars).",
  },
};

export default async function PreferencesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ gcal?: string }>;
}) {
  // Personal to every logged-in user — no role gate.
  const profile = await requireProfile();
  const prefs = await getUserPreferences();
  const showCalendar = CALENDAR_ROLES.includes(profile.role);
  const gstatus = showCalendar
    ? await getMyGoogleStatus()
    : { connected: false, email: null };
  const configured = googleConfigured();
  const sp = await searchParams;
  const flash = sp.gcal ? GCAL_MESSAGES[sp.gcal] : null;

  // Shared team calendar — admin-only. Only load Google calendars once the
  // admin is connected (and the upgraded scope is granted).
  const isAdmin = profile.role === "admin";
  const showTeamCalendar = isAdmin && configured;
  const teamCal = showTeamCalendar ? await getTeamCalendar() : null;
  const myCalendars =
    showTeamCalendar && gstatus.connected ? await listMyCalendars() : [];

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

      {showCalendar ? (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Calendar className="size-5" />
                </span>
                <div>
                  <div className="font-semibold">Google Calendar</div>
                  <div className="text-sm text-muted-foreground">
                    {gstatus.connected
                      ? `Connected${gstatus.email ? ` as ${gstatus.email}` : ""} — your appointments sync both ways.`
                      : "Connect so your estimates & appointments appear on your Google Calendar (and back)."}
                  </div>
                </div>
              </div>
              {!configured ? (
                <span className="text-xs font-medium text-amber-600">
                  Not set up on the server yet
                </span>
              ) : gstatus.connected ? (
                <form action={disconnectGoogleCalendar}>
                  <Button type="submit" variant="outline" size="sm">
                    Disconnect
                  </Button>
                </form>
              ) : (
                <a
                  href="/api/google/connect"
                  className={buttonVariants({ size: "sm" })}
                >
                  <Calendar className="size-4" /> Connect Google Calendar
                </a>
              )}
            </div>

            {flash ? (
              <div
                className={
                  "mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm " +
                  (flash.ok
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300")
                }
              >
                {flash.ok ? (
                  <CheckCircle2 className="size-4" />
                ) : (
                  <AlertTriangle className="size-4" />
                )}
                {flash.text}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {showTeamCalendar ? (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Users className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Team calendar</div>
                <div className="text-sm text-muted-foreground">
                  One shared calendar every appointment syncs into — so the whole
                  crew sees the full schedule, not just their own jobs. Each event
                  is labelled with the rep it belongs to.
                </div>

                {!gstatus.connected ? (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    Connect your Google Calendar above first — the shared calendar
                    lives in your Google account.
                  </div>
                ) : (
                  <>
                    {teamCal ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <CheckCircle2 className="size-4 shrink-0" />
                        <span>
                          Syncing all appointments to{" "}
                          <strong>{teamCal.calendarName ?? "your calendar"}</strong>
                          .
                        </span>
                      </div>
                    ) : null}

                    {myCalendars.length > 0 ? (
                      <>
                        <form
                          action={setTeamCalendar}
                          className="mt-3 flex flex-wrap items-center gap-2"
                        >
                          <SearchPicker
                            className="w-64"
                            name="calendar_id"
                            defaultValue={teamCal?.calendarId ?? ""}
                            placeholder="Choose a calendar…"
                            options={myCalendars.map((c) => ({
                              value: c.id,
                              label: c.primary
                                ? `${c.summary} (your main calendar)`
                                : c.summary,
                            }))}
                          />
                          <Button type="submit" size="sm">
                            Use this calendar
                          </Button>
                        </form>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <form action={createTeamCalendar}>
                            <Button type="submit" variant="outline" size="sm">
                              <CalendarDays className="size-4" /> Create a new
                              “Floor King Schedule” calendar
                            </Button>
                          </form>
                          {teamCal ? (
                            <form action={unsetTeamCalendar}>
                              <Button type="submit" variant="ghost" size="sm">
                                Turn off shared calendar
                              </Button>
                            </form>
                          ) : null}
                        </div>
                        {teamCal ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Tip: in Google Calendar, share “
                            {teamCal.calendarName ?? "this calendar"}” with your
                            crew’s Google accounts so it shows up on their phones.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                        Reconnect Google Calendar above to grant the new
                        “manage calendars” permission, then your calendars will
                        show here.
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <PreferencesForm prefs={prefs} />
        </CardContent>
      </Card>
    </div>
  );
}

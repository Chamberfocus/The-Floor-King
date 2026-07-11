import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { listTeamMembers } from "@/lib/data/team";
import { listInstallCrews, getCrewPayoutTotals } from "@/lib/data/install-crews";
import { getBusinessSettings } from "@/lib/data/business-settings";
import { InviteTeamForm } from "./invite-form";
import { RoleSelect } from "./role-select";
import { RemoveMember } from "./remove-member";
import { ActiveToggle } from "./active-toggle";
import { InstallCrewsManager } from "../install-crews/install-crews-manager";
import {
  setMemberTitle,
  setMemberHome,
  setMemberPhonePin,
  setMemberName,
  setInstallerCollects,
} from "./actions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const me = await requireProfile();
  if (me.role !== "admin") redirect("/");
  const members = await listTeamMembers();
  const adminCount = members.filter((m) => m.role === "admin").length;
  const settings = await getBusinessSettings();
  const installerCollects = settings.installer_collects_balance;
  // Subcontractor installers with NO app login (real subs) — managed right here
  // so employees + subs live on one page. Employees who also got a mirror crew
  // are filtered out so nobody is duplicated.
  const memberNames = new Set(
    members.map((m) => (m.full_name ?? "").trim().toLowerCase()),
  );
  const [allCrews, payouts] = await Promise.all([
    listInstallCrews(),
    getCrewPayoutTotals(),
  ]);
  const subCrews = allCrews.filter(
    (c) => !memberNames.has((c.name ?? "").trim().toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Team & installers"
        description="Everyone in one place — office staff, installer logins, and subcontractor crews."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Installer collections</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">
            Let the <strong>assigned installer</strong> collect the remaining
            balance on site (cash, check, or request an online payment). When off,
            only the office collects and crews never see the money.
          </p>
          <form action={setInstallerCollects}>
            <input
              type="hidden"
              name="on"
              value={installerCollects ? "false" : "true"}
            />
            <Button
              type="submit"
              size="sm"
              variant={installerCollects ? "default" : "outline"}
            >
              {installerCollects ? "On — installers can collect" : "Off — turn on"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a team member</CardTitle>
        </CardHeader>
        <CardContent>
          <InviteTeamForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your team</CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {members.map((m) => (
                <li
                  key={m.id}
                  className={m.active ? "space-y-2 py-3" : "space-y-2 py-3 opacity-60"}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <form
                      action={setMemberName}
                      className="flex min-w-0 items-center gap-1"
                    >
                      <input type="hidden" name="id" value={m.id} />
                      <input
                        name="full_name"
                        defaultValue={m.full_name ?? ""}
                        placeholder="Full name"
                        className="h-8 w-44 rounded-md border border-input bg-transparent px-2 text-sm font-medium"
                      />
                      <Button type="submit" variant="ghost" size="sm">
                        Save
                      </Button>
                      {!m.active ? (
                        <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600">
                          Deactivated
                        </span>
                      ) : null}
                      <span className="ml-1 hidden truncate text-xs text-muted-foreground sm:inline">
                        {m.email}
                        {m.id === me.id ? " · you" : ""}
                      </span>
                    </form>
                    <div className="flex items-center gap-2">
                      <form action={setMemberTitle} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={m.id} />
                        <input
                          name="title"
                          defaultValue={m.title ?? ""}
                          placeholder="Job title"
                          className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-sm"
                        />
                        <Button type="submit" variant="outline" size="sm">
                          Save
                        </Button>
                      </form>
                      <RoleSelect id={m.id} role={m.role} />
                      {m.id !== me.id ? (
                        <ActiveToggle
                          id={m.id}
                          name={m.full_name || m.email}
                          active={m.active}
                        />
                      ) : null}
                      {m.id !== me.id &&
                      !(m.role === "admin" && adminCount <= 1) ? (
                        <RemoveMember
                          id={m.id}
                          name={m.full_name || m.email}
                        />
                      ) : null}
                    </div>
                  </div>
                  <form action={setMemberHome} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={m.id} />
                    <input
                      name="home_address"
                      defaultValue={m.home_address ?? ""}
                      placeholder="Home base address (routes their estimates)"
                      className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      Save base
                    </Button>
                  </form>
                  <form
                    action={setMemberPhonePin}
                    className="flex items-center gap-1"
                  >
                    <input type="hidden" name="id" value={m.id} />
                    <PhoneInput
                      name="phone"
                      defaultValue={m.phone ?? ""}
                      placeholder="Phone for sign-in"
                      className="h-8 w-40 text-sm"
                    />
                    <input
                      name="pin"
                      placeholder="New PIN (6+)"
                      className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-sm"
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      Set phone PIN
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Scheduling capacity per installer */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" /> Installer scheduling
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-sm text-muted-foreground">
            Set each installer&apos;s work days and daily capacity — that&apos;s
            what powers next-available suggestions and the install grid.
          </p>
          <Link
            href="/settings/scheduling"
            className="shrink-0 rounded-md bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/20"
          >
            Scheduling settings →
          </Link>
        </CardContent>
      </Card>

      {/* Subcontractor installers (no app login) */}
      <div className="mt-8">
        <h2 className="mb-1 text-lg font-bold">Subcontractor installers</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Crews you assign jobs to that don&apos;t have an app login. People above
          with a login don&apos;t need one here.
        </p>
        <InstallCrewsManager initial={subCrews} payouts={payouts} />
      </div>
    </div>
  );
}

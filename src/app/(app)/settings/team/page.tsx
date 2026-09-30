import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
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
import { TeamMemberRow } from "./team-member-row";
import { InstallCrewsManager } from "../install-crews/install-crews-manager";
import { LifecycleFilter } from "@/components/record-lifecycle-menu";
import { lifecycleSchemaReady } from "@/lib/record-lifecycle-db";
import { parseLifecycleView } from "@/lib/record-lifecycle";
import { setInstallerCollects } from "./actions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ life?: string }>;
}) {
  const me = await requireProfile();
  if (me.role !== "admin") redirect("/");
  const lifecycle = parseLifecycleView((await searchParams).life);
  const lifecycleReady = await lifecycleSchemaReady();
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
    listInstallCrews({ lifecycle: "all" }),
    getCrewPayoutTotals(),
  ]);
  const subCrews = allCrews.filter((c) => {
    if (memberNames.has((c.name ?? "").trim().toLowerCase())) return false;
    if (!lifecycleReady || lifecycle === "all") return true;
    const archived = Boolean(c.archived_at);
    return lifecycle === "archived" ? archived : !archived;
  });
  // Skills live on an installer's crew row (the Job Board reads them by
  // profile_id); map them by profile so each installer row can show/set them.
  const skillsByProfile = new Map<string, string[]>();
  const crewByProfile = new Map<string, { id: string; archivedAt: string | null }>();
  for (const c of allCrews) {
    if (c.profile_id) {
      skillsByProfile.set(c.profile_id, c.skills ?? []);
      crewByProfile.set(c.profile_id, { id: c.id, archivedAt: c.archived_at ?? null });
    }
  }
  for (const member of members) {
    if (crewByProfile.has(member.id)) continue;
    const named = allCrews.find(
      (c) => (c.name ?? "").trim().toLowerCase() === (member.full_name ?? "").trim().toLowerCase(),
    );
    if (!named || !(member.full_name ?? "").trim()) continue;
    crewByProfile.set(member.id, { id: named.id, archivedAt: named.archived_at ?? null });
  }

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
            <ul className="divide-y">
              {members.map((m) => (
                <TeamMemberRow
                  key={m.id}
                  member={m}
                  isMe={m.id === me.id}
                  canToggleActive={m.id !== me.id}
                  canRemove={m.id !== me.id && !(m.role === "admin" && adminCount <= 1)}
                  isCrew={m.role === "crew"}
                  skills={skillsByProfile.get(m.id) ?? []}
                  crewRecord={crewByProfile.get(m.id) ?? null}
                  allowArchive={me.role === "admin" || me.role === "office"}
                  allowDelete={me.role === "admin"}
                />
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
          with a login don&apos;t need one here. Archive hides a crew from new
          assignments and keeps its job history.
        </p>
        <LifecycleFilter
          ready={lifecycleReady}
          value={lifecycle}
          makeHref={(next) => (next === "active" ? "/settings/team" : `/settings/team?life=${next}`)}
        />
        <InstallCrewsManager
          initial={subCrews}
          payouts={payouts}
          allowArchive={me.role === "admin" || me.role === "office"}
          allowDelete={me.role === "admin"}
        />
      </div>
    </div>
  );
}

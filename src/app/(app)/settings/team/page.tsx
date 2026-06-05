import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { listTeamMembers } from "@/lib/data/team";
import { InviteTeamForm } from "./invite-form";
import { RoleSelect } from "./role-select";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const members = await listTeamMembers();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Team"
        description="Create logins for your office staff, installers, and warehouse crew."
      />

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
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {m.full_name || m.email}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.email}
                    </div>
                  </div>
                  <RoleSelect id={m.id} role={m.role} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

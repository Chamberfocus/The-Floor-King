import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { listTeamMembers } from "@/lib/data/team";
import { InviteTeamForm } from "./invite-form";
import { RoleSelect } from "./role-select";
import { setMemberTitle, setMemberHome } from "./actions";

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
                <li key={m.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {m.full_name || m.email}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.email}
                      </div>
                    </div>
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
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

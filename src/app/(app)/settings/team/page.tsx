import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listTeamMembers } from "@/lib/data/team";
import { InviteTeamForm } from "./invite-form";
import { RoleSelect } from "./role-select";
import { RemoveMember } from "./remove-member";
import {
  setMemberTitle,
  setMemberHome,
  setMemberPhonePin,
  setMemberName,
} from "./actions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const [members, me] = await Promise.all([
    listTeamMembers(),
    requireProfile(),
  ]);
  const adminCount = members.filter((m) => m.role === "admin").length;

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
                    <input
                      name="phone"
                      defaultValue={m.phone ?? ""}
                      placeholder="Phone for sign-in"
                      className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-sm"
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
    </div>
  );
}

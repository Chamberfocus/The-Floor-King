"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS } from "@/lib/types";
import { inviteTeamMember, type TeamFormState } from "./actions";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const initialState: TeamFormState = { error: null };

export function InviteTeamForm() {
  const [state, formAction, pending] = useActionState(
    inviteTeamMember,
    initialState,
  );

  useEffect(() => {
    if (state.ok) toast.success("Login created — share the credentials");
  }, [state]);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="full_name">Name</Label>
        <Input id="full_name" name="full_name" placeholder="Mike Installer" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="role">Role</Label>
        <select id="role" name="role" defaultValue="crew" className={fieldClass}>
          <option value="crew">{ROLE_LABELS.crew}</option>
          <option value="warehouse">{ROLE_LABELS.warehouse}</option>
          <option value="office">{ROLE_LABELS.office}</option>
          <option value="admin">{ROLE_LABELS.admin}</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Temporary password</Label>
        <Input
          id="password"
          name="password"
          type="text"
          placeholder="At least 8 characters"
          required
        />
      </div>
      {state.error ? (
        <p className="text-sm text-destructive sm:col-span-2" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create login"}
        </Button>
      </div>
    </form>
  );
}

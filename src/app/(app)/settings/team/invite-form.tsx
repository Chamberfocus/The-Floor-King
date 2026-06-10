"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteTeamMember, type TeamFormState } from "./actions";
import { POSITIONS } from "./positions";

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
        <Label htmlFor="title">Job title</Label>
        <Input id="title" name="title" placeholder="e.g. Lead Estimator" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="position">Position</Label>
        <select
          id="position"
          name="position"
          defaultValue="salesman"
          className={fieldClass}
        >
          {POSITIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="home_address">Home base address (for routing, optional)</Label>
        <Input
          id="home_address"
          name="home_address"
          placeholder="Where their day starts (used to route estimates)"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email (optional)</Label>
        <Input id="email" name="email" type="email" placeholder="optional" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="phone">Phone number</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          placeholder="(216) 555-1212"
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="password">PIN / password</Label>
        <Input
          id="password"
          name="password"
          type="text"
          placeholder="At least 6 characters/digits — they'll use this to sign in"
          required
        />
        <p className="text-xs text-muted-foreground">
          Give them an <strong>email or a phone number</strong> (or both). With a
          phone, they sign in using <strong>phone + this PIN</strong> — no email
          needed.
        </p>
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

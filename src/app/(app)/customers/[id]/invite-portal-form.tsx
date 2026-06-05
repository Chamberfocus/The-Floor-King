"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  inviteCustomerToPortal,
  type CustomerFormState,
} from "../actions";

const initialState: CustomerFormState = { error: null };

export function InvitePortalForm({
  customerId,
  defaultEmail,
}: {
  customerId: string;
  defaultEmail: string;
}) {
  const [state, formAction, pending] = useActionState(
    inviteCustomerToPortal,
    initialState,
  );

  useEffect(() => {
    if (state.ok) toast.success("Portal login created — share the credentials");
  }, [state]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="customer_id" value={customerId} />
      <div className="space-y-1">
        <Label htmlFor="portal_email" className="text-xs">
          Customer email
        </Label>
        <Input
          id="portal_email"
          name="email"
          type="email"
          defaultValue={defaultEmail}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="portal_password" className="text-xs">
          Temporary password (you&apos;ll share this)
        </Label>
        <Input
          id="portal_password"
          name="password"
          type="text"
          placeholder="At least 8 characters"
          required
        />
      </div>
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button
        type="submit"
        size="sm"
        disabled={pending}
        className="w-full"
      >
        {pending ? "Creating…" : "Create portal login"}
      </Button>
    </form>
  );
}

"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { createPriceBookLogin, type PriceBookFormState } from "./actions";

const initialState: PriceBookFormState = { error: null };

export function PriceBookAccessForm() {
  const [state, formAction, pending] = useActionState(createPriceBookLogin, initialState);

  useEffect(() => {
    if (state.ok) toast.success("Login created. Share the email or phone and the password.");
  }, [state]);

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="full_name">Name</Label>
        <Input id="full_name" name="full_name" placeholder="Who this price list is for" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="margin_pct">Gross margin %</Label>
        <Input
          id="margin_pct"
          name="margin_pct"
          type="number"
          inputMode="decimal"
          min={0}
          max={99.999}
          step="0.1"
          required
          placeholder="40"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="optional if you use a phone" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="phone">Phone</Label>
        <PhoneInput id="phone" name="phone" placeholder="216-555-1212" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="text" required placeholder="At least 6 characters" />
        <p className="text-xs text-muted-foreground">
          A 40% margin turns a $6.00 cost into a $10.00 sell price before freight.
          They see that sell price. They do not see the cost or the margin.
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

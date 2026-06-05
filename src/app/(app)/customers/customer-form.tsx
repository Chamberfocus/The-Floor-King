"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  type Customer,
} from "@/lib/types";
import { createCustomer, updateCustomer, type CustomerFormState } from "./actions";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const initialState: CustomerFormState = { error: null };

export function CustomerForm({
  customer,
  onSaved,
}: {
  customer?: Customer;
  onSaved?: () => void;
}) {
  const isEdit = Boolean(customer);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateCustomer : createCustomer,
    initialState,
  );

  useEffect(() => {
    if (state.ok) {
      toast.success("Saved");
      onSaved?.();
    }
  }, [state.ok, onSaved]);

  return (
    <form action={formAction} className="space-y-5">
      {isEdit ? <input type="hidden" name="id" value={customer!.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="full_name">Name *</Label>
          <Input
            id="full_name"
            name="full_name"
            defaultValue={customer?.full_name ?? ""}
            placeholder="Jane Homeowner"
            required
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={customer?.phone ?? ""}
            placeholder="(216) 555-0142"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={customer?.email ?? ""}
            placeholder="jane@example.com"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="company">Company (optional)</Label>
          <Input
            id="company"
            name="company"
            defaultValue={customer?.company ?? ""}
            placeholder="For commercial / builder accounts"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="street">Job address</Label>
          <Input
            id="street"
            name="street"
            defaultValue={customer?.street ?? ""}
            placeholder="Street address"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" defaultValue={customer?.city ?? ""} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input
              id="state"
              name="state"
              defaultValue={customer?.state ?? "OH"}
              maxLength={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zip">ZIP</Label>
            <Input id="zip" name="zip" defaultValue={customer?.zip ?? ""} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="source">Lead source * (where did they come from?)</Label>
          <select
            id="source"
            name="source"
            defaultValue={customer?.source ?? ""}
            required
            className={selectClass}
          >
            <option value="">— Select a source —</option>
            {Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {!isEdit ? (
          <div className="space-y-2">
            <Label htmlFor="stage">Stage</Label>
            <select
              id="stage"
              name="stage"
              defaultValue="new"
              className={selectClass}
            >
              {LEAD_STAGE_ORDER.map((value) => (
                <option key={value} value={value}>
                  {LEAD_STAGE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            name="notes"
            defaultValue={customer?.notes ?? ""}
            rows={3}
            placeholder="What flooring are they interested in? Rooms, square footage, timeline…"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
        </Button>
      </div>
    </form>
  );
}

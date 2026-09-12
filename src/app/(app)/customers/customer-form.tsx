"use client";

import { useActionState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { AddressFields } from "./address-fields";
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  type Customer,
  type LeadSourceRow,
} from "@/lib/types";
import { createCustomer, updateCustomer, type CustomerFormState } from "./actions";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SourceFields } from "./source-fields";

const initialState: CustomerFormState = { error: null };

export function CustomerForm({
  customer,
  onSaved,
  sources = [],
  referrerCustomers = [],
}: {
  customer?: Customer;
  onSaved?: () => void;
  sources?: LeadSourceRow[];
  referrerCustomers?: { id: string; full_name: string }[];
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
    <form action={formAction} data-tour="customer-form" className="space-y-5">
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
          <PhoneInput
            id="phone"
            name="phone"
            defaultValue={customer?.phone ?? ""}
            placeholder="216-555-0142"
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

        <AddressFields
          defaults={{
            street: customer?.street,
            city: customer?.city,
            state: customer?.state,
            zip: customer?.zip,
          }}
        />

        <SourceFields
          sources={sources}
          customers={referrerCustomers}
          initial={{
            source_id: customer?.source_id,
            source_detail_id: customer?.source_detail_id,
            source_detail_text: customer?.source_detail_text,
            referred_by_customer_id: customer?.referred_by_customer_id,
          }}
        />

        {!isEdit ? (
          <div className="space-y-2">
            <Label>Stage</Label>
            <SegmentedField
              name="stage"
              defaultValue="new"
              options={LEAD_STAGE_ORDER.map((value) => ({
                value,
                label: LEAD_STAGE_LABELS[value],
              }))}
            />
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

      {/* Possible duplicate — surfaced on create so the same client isn't added
          twice. A warning, not a wall: they can open the match or add anyway. */}
      {!isEdit && state.duplicates?.length ? (
        <div className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4" />
            {state.duplicates.some((d) => d.confidence === "high")
              ? "Strong match — same phone or email"
              : state.duplicates.length === 1
                ? "This might already be in your customers"
                : "These might already be in your customers"}
          </div>
          <ul className="space-y-1.5">
            {state.duplicates.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-md border bg-background px-2.5 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.full_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[d.phone, d.email, d.street || d.city].filter(Boolean).join(" · ") || "No contact details"}
                  </div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">
                    Same {d.reason === "name" ? "name" : d.reason}
                    {d.confidence === "high" ? " · high confidence" : ""}
                    {typeof d.jobCount === "number"
                      ? ` · ${d.jobCount} job${d.jobCount === 1 ? "" : "s"}`
                      : ""}
                  </div>
                </div>
                <Link
                  href={`/customers/${d.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <ExternalLink className="size-3.5" /> Open
                </Link>
              </li>
            ))}
          </ul>
          {state.duplicates.some((d) => d.confidence === "high") ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-amber-900 dark:text-amber-200">
                Reason for creating a new customer (required)
              </label>
              <input
                name="duplicate_override_reason"
                required
                placeholder="e.g. Same phone, different household / new tenant"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              If this is a different person, add them anyway.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        {!isEdit && state.duplicates?.length ? (
          <Button
            type="submit"
            name="force_create"
            value="1"
            variant="outline"
            disabled={pending}
          >
            {pending
              ? "Adding…"
              : state.duplicates.some((d) => d.confidence === "high")
                ? "Create with override"
                : "Add anyway"}
          </Button>
        ) : (
          <Button type="submit" data-tour="customer-save" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create customer"}
          </Button>
        )}
      </div>
    </form>
  );
}

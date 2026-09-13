"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatMoney } from "@/lib/format";
import {
  PROFILE_MERGE_FIELDS,
  conflictingProfileFields,
  mergeIdempotencyKey,
  type CleanupCustomer,
  type MergeMoveCounts,
  type ProfileMergeField,
} from "@/lib/customer-duplicate-cleanup";
import { mergeDuplicateCustomers, type MergeActionState } from "./actions";

const initial: MergeActionState = { ok: false, error: null };

const FIELD_LABEL: Record<ProfileMergeField, string> = {
  full_name: "Name",
  phone: "Phone",
  email: "Email",
  street: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  assigned_to: "Salesperson",
  company: "Customer type / company",
  notes: "Notes / metadata",
};

function val(c: CleanupCustomer, field: ProfileMergeField): string {
  return ((c[field] ?? "") as string).toString() || "—";
}

export function MergeReviewForm({
  left,
  right,
  countsLeftToRight,
  countsRightToLeft,
  openArCombined,
  portalConflict,
  draftConflict,
  canMerge,
}: {
  left: CleanupCustomer;
  right: CleanupCustomer;
  countsLeftToRight: MergeMoveCounts;
  countsRightToLeft: MergeMoveCounts;
  openArCombined: number;
  portalConflict: boolean;
  draftConflict: boolean;
  canMerge: boolean;
}) {
  const [survivor, setSurvivor] = useState<"left" | "right">("left");
  const [state, action] = useActionState(mergeDuplicateCustomers, initial);
  const surviving = survivor === "left" ? left : right;
  const duplicate = survivor === "left" ? right : left;
  const moving = survivor === "left" ? countsRightToLeft : countsLeftToRight;
  const conflicts = useMemo(
    () => conflictingProfileFields(surviving, duplicate),
    [surviving, duplicate],
  );
  const blocked = portalConflict || draftConflict || !canMerge;
  const idempotency = mergeIdempotencyKey(surviving.id, duplicate.id);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="survivor_id" value={surviving.id} />
      <input type="hidden" name="duplicate_id" value={duplicate.id} />
      <input type="hidden" name="idempotency_key" value={idempotency} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Surviving customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <input
              type="radio"
              name="survivor_choice"
              checked={survivor === "left"}
              onChange={() => setSurvivor("left")}
            />
            <span>
              <span className="block font-semibold">{left.full_name}</span>
              <span className="block font-mono text-xs text-muted-foreground">
                {left.id}
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <input
              type="radio"
              name="survivor_choice"
              checked={survivor === "right"}
              onChange={() => setSurvivor("right")}
            />
            <span>
              <span className="block font-semibold">{right.full_name}</span>
              <span className="block font-mono text-xs text-muted-foreground">
                {right.id}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Field comparison</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {PROFILE_MERGE_FIELDS.map((field) => {
            const conflict = conflicts.includes(field);
            const a = val(surviving, field);
            const b = val(duplicate, field);
            return (
              <div key={field} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[8rem_1fr_1fr]">
                <div className="text-sm font-medium">{FIELD_LABEL[field]}</div>
                <Label className="text-sm font-normal">
                  {conflict ? (
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`field_${field}`}
                        value="survivor"
                        required
                        defaultChecked
                      />
                      Keep {a}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{a}</span>
                  )}
                </Label>
                <Label className="text-sm font-normal">
                  {conflict ? (
                    <span className="flex items-center gap-2">
                      <input type="radio" name={`field_${field}`} value="duplicate" />
                      Use {b}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{b}</span>
                  )}
                </Label>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Moving from {duplicate.full_name} → {surviving.full_name}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>Jobs: {moving.jobs}</div>
          <div>Estimates: {moving.estimates}</div>
          <div>Invoices: {moving.invoices}</div>
          <div>Open AR: {formatMoney(openArCombined)}</div>
          <div>Cash &amp; Carry: {moving.cashAndCarry}</div>
          <div>Orders: {moving.orders}</div>
          <div>Appointments: {moving.appointments}</div>
          <div>Documents: {moving.documents}</div>
          <div>Notes: {moving.notes}</div>
          <div>Deposits: {moving.deposits}</div>
          <div>Credits: {moving.credits}</div>
          <div>Refunds: {moving.refunds}</div>
        </CardContent>
      </Card>

      {portalConflict ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Both records have customer portal logins. Merge is blocked until portal
          identity is resolved so one household is not granted another customer&apos;s data.
        </div>
      ) : null}
      {draftConflict ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Both records have an in-progress estimate draft. Resolve drafts before merging.
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="reason">Merge reason</Label>
        <textarea
          id="reason"
          name="reason"
          required
          rows={3}
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          placeholder="Why these records are the same customer"
        />
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <SubmitButton disabled={blocked} confirm={null}>
          Merge into {surviving.full_name}
        </SubmitButton>
        <Link href="/customers/duplicates" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
        {!canMerge ? (
          <p className="self-center text-sm text-muted-foreground">
            Sales managers can review groups. Only office/admin can merge.
          </p>
        ) : null}
      </div>
    </form>
  );
}

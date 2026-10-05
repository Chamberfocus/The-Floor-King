"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import { SegmentedField } from "@/components/ui/segmented-field";
import {
  createCustomerSafe,
  loadSafeCustomerOptions,
  type SafeCustomerFormState,
  type SafeLeadSource,
} from "./actions";

const initialState: SafeCustomerFormState = { error: null };

const STAGES = [
  ["new", "New"],
  ["contacted", "Contacted"],
  ["estimate_scheduled", "Estimate Scheduled"],
  ["quoted", "Quoted"],
  ["won", "Won"],
  ["lost", "Lost"],
] as const;

export function FullSafeCustomerForm() {
  const [state, formAction, pending] = useActionState(createCustomerSafe, initialState);
  const [sources, setSources] = useState<SafeLeadSource[]>([]);
  const [referrers, setReferrers] = useState<{ id: string; full_name: string }[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [detailId, setDetailId] = useState("");
  const [detailText, setDetailText] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);

  useEffect(() => {
    let live = true;
    loadSafeCustomerOptions()
      .then((o) => {
        if (!live) return;
        setSources(o.sources);
        setReferrers(o.referrers);
      })
      .finally(() => {
        if (live) setLoadingOptions(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const source = useMemo(
    () => sources.find((s) => s.id === sourceId),
    [sources, sourceId],
  );

  function chooseSource(id: string) {
    setSourceId(id);
    setDetailId("");
    setDetailText("");
    setReferredBy("");
  }

  const sourceOptions = sources.map((s) => ({ value: s.id, label: s.label }));
  const referrerOptions = referrers.map((r) => ({ value: r.id, label: r.full_name }));

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="full_name">Name *</Label>
          <Input id="full_name" name="full_name" required autoFocus placeholder="Jane Homeowner" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <PhoneInput id="phone" name="phone" placeholder="216-555-0142" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="jane@example.com" />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="company">Company (optional)</Label>
          <Input id="company" name="company" placeholder="For commercial / builder accounts" />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="street">Job address</Label>
          <Input id="street" name="street" placeholder="Street address" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Input id="state" name="state" defaultValue="OH" maxLength={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="zip">ZIP</Label>
            <Input id="zip" name="zip" />
          </div>
        </div>

        <div className="space-y-3 sm:col-span-2">
          <div className="space-y-2">
            <Label>How did you hear about us? *</Label>
            <SearchPicker
              value={sourceId}
              onChange={chooseSource}
              placeholder={loadingOptions ? "Loading sources…" : "Choose a source…"}
              options={sourceOptions}
            />
            <input type="hidden" name="source_id" value={sourceId} />
          </div>

          {source?.detail_mode === "options" ? (
            <div className="space-y-2">
              <Label>
                {source.detail_label || "Which one?"}
                {source.detail_required ? " *" : null}
              </Label>
              <div className="flex flex-wrap gap-2">
                {source.details.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDetailId(detailId === d.id ? "" : d.id)}
                    className={
                      detailId === d.id
                        ? "rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
                        : "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                    }
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <input type="hidden" name="source_detail_id" value={detailId} />
              <Input
                name="source_detail_text"
                value={detailText}
                onChange={(e) => setDetailText(e.target.value)}
                placeholder="Specific campaign / detail (optional)"
              />
              <input type="hidden" name="referred_by_customer_id" value="" />
            </div>
          ) : source?.detail_mode === "referrer" ? (
            <div className="space-y-2">
              <Label>
                {source.detail_label || "Who referred you?"}
                {source.detail_required ? " *" : null}
              </Label>
              <Input
                name="source_detail_text"
                value={detailText}
                onChange={(e) => setDetailText(e.target.value)}
                placeholder="Referrer name (person or business)"
              />
              <input type="hidden" name="source_detail_id" value="" />
              {referrerOptions.length ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    …or link an existing customer:
                  </div>
                  <SearchPicker
                    value={referredBy}
                    onChange={setReferredBy}
                    placeholder="Search customers…"
                    options={referrerOptions}
                  />
                  <input type="hidden" name="referred_by_customer_id" value={referredBy} />
                </>
              ) : (
                <input type="hidden" name="referred_by_customer_id" value="" />
              )}
            </div>
          ) : (
            <>
              <input type="hidden" name="source_detail_id" value="" />
              <input type="hidden" name="source_detail_text" value="" />
              <input type="hidden" name="referred_by_customer_id" value="" />
            </>
          )}
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label>Stage</Label>
          <SegmentedField
            name="stage"
            defaultValue="new"
            options={STAGES.map(([value, label]) => ({ value, label }))}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            placeholder="Flooring interest, rooms, square footage, timing, important notes…"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      {state.duplicates?.length ? (
        <div className="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-4" />
            Possible duplicate customer
          </div>
          <div className="space-y-2">
            {state.duplicates.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{d.full_name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[d.phone, d.email, d.street || d.city].filter(Boolean).join(" · ") || "No contact details"}
                  </div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-400">
                    Match: {d.reason.replace("_", " ")}
                    {d.confidence === "high" ? " · high confidence" : ""}
                  </div>
                </div>
                <Link href={`/customers/${d.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <ExternalLink className="size-3.5" /> Open
                </Link>
              </div>
            ))}
          </div>

          {state.duplicates.some((d) => d.confidence === "high") ? (
            <div className="space-y-2">
              <Label htmlFor="duplicate_override_reason">
                Reason for creating a separate customer
              </Label>
              <Input
                id="duplicate_override_reason"
                name="duplicate_override_reason"
                placeholder="e.g. Same phone, different household"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        {state.duplicates?.length ? (
          <Button type="submit" name="force_create" value="1" variant="outline" disabled={pending}>
            {pending ? "Creating…" : "Create anyway"}
          </Button>
        ) : (
          <Button type="submit" disabled={pending || loadingOptions}>
            {pending ? "Creating…" : "Create customer"}
          </Button>
        )}
      </div>
    </form>
  );
}

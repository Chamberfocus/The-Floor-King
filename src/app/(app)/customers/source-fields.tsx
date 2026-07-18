"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";
import type { LeadSourceRow } from "@/lib/types";

/**
 * "How did you hear about us?" capture — a SELECTED source plus its configured
 * drill-down sub-detail (options, or a referrer name + optional link to an
 * existing customer). Emits hidden inputs so it works inside any form. Shared by
 * the customer form and the inline estimate prompt.
 */
export function SourceFields({
  sources,
  customers = [],
  initial,
}: {
  sources: LeadSourceRow[];
  customers?: { id: string; full_name: string }[];
  initial?: {
    source_id?: string | null;
    source_detail_id?: string | null;
    source_detail_text?: string | null;
    referred_by_customer_id?: string | null;
  };
}) {
  const [sourceId, setSourceId] = useState(initial?.source_id ?? "");
  const [detailId, setDetailId] = useState(initial?.source_detail_id ?? "");
  const [detailText, setDetailText] = useState(initial?.source_detail_text ?? "");
  const [referredBy, setReferredBy] = useState(initial?.referred_by_customer_id ?? "");

  const src = sources.find((s) => s.id === sourceId);
  const mode = src?.detail_mode ?? "none";
  const required = !!src?.detail_required;

  const pickSource = (v: string) => {
    setSourceId(v);
    setDetailId("");
    setDetailText("");
    setReferredBy("");
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>How did you hear about us? *</Label>
        <SearchPicker
          value={sourceId}
          onChange={pickSource}
          placeholder="Choose a source…"
          options={sources.map((s) => ({ value: s.id, label: s.label }))}
        />
        <input type="hidden" name="source_id" value={sourceId} />
      </div>

      {mode === "options" ? (
        <div className="space-y-2">
          <Label>
            {src?.detail_label || "Which one?"}
            {required ? " *" : null}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {(src?.details ?? []).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDetailId(detailId === d.id ? "" : d.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm font-medium",
                  detailId === d.id ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted",
                )}
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
            className="h-9"
          />
          <input type="hidden" name="referred_by_customer_id" value="" />
        </div>
      ) : mode === "referrer" ? (
        <div className="space-y-2">
          <Label>
            {src?.detail_label || "Who referred you?"}
            {required ? " *" : null}
          </Label>
          <Input
            name="source_detail_text"
            value={detailText}
            onChange={(e) => setDetailText(e.target.value)}
            placeholder="Referrer name (person or business)"
            className="h-9"
          />
          <input type="hidden" name="source_detail_id" value="" />
          {customers.length ? (
            <>
              <div className="text-xs text-muted-foreground">…or link an existing customer:</div>
              <SearchPicker
                value={referredBy}
                onChange={setReferredBy}
                placeholder="Search customers…"
                options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
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
  );
}

/** True when the current selection satisfies the source's required sub-detail —
 *  for client-side gating of a submit button. */
export function sourceSelectionComplete(
  sources: LeadSourceRow[],
  sel: { source_id: string; source_detail_id: string; source_detail_text: string; referred_by_customer_id: string },
): boolean {
  const src = sources.find((s) => s.id === sel.source_id);
  if (!src) return false;
  if (!src.detail_required) return true;
  if (src.detail_mode === "referrer") return !!(sel.source_detail_text.trim() || sel.referred_by_customer_id);
  if (src.detail_mode === "options") return !!(sel.source_detail_id || sel.source_detail_text.trim());
  return true;
}

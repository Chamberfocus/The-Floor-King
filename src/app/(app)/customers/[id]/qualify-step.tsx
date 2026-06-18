"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";
import { wizardSectionRank, type QualifyingQuestion } from "@/lib/types";
import type { HandoffMember } from "@/lib/data/workflow";
import { qualifyAndAssign } from "./qualify-actions";

/**
 * Guided-flow step 1: fill out the intake questionnaire and assign the lead to
 * someone in one shot. Saving advances the lead to "Estimate Needs Scheduled".
 */
export function QualifyStep({
  customerId,
  questions,
  members,
  defaultOwner,
}: {
  customerId: string;
  questions: QualifyingQuestion[];
  members: HandoffMember[];
  defaultOwner: string | null;
}) {
  const [owner, setOwner] = useState(defaultOwner ?? "");
  const sections = Array.from(new Set(questions.map((q) => q.section))).sort(
    (a, b) => wizardSectionRank(a) - wizardSectionRank(b) || a.localeCompare(b),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Qualify this lead, then hand it to whoever owns it next. Saving moves it
        straight to scheduling the estimate.
      </p>

      <form action={qualifyAndAssign} className="space-y-4">
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="owner" value={owner} />

        {questions.length > 0 ? (
          sections.map((section) => (
            <div key={section} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section}
              </div>
              {questions
                .filter((q) => q.section === section)
                .sort((a, b) => a.position - b.position)
                .map((q) => (
                  <div key={q.id} className="space-y-1">
                    <label className="text-sm font-medium">
                      {q.required ? <span className="text-amber-600">★ </span> : null}
                      {q.label}
                    </label>
                    {q.help ? (
                      <p className="text-xs text-muted-foreground">{q.help}</p>
                    ) : null}
                    {q.options?.length ? (
                      <SegmentedField
                        name={`q_${q.id}`}
                        defaultValue=""
                        options={q.options.map((o) => ({ value: o, label: o }))}
                      />
                    ) : (
                      <textarea
                        name={`q_${q.id}`}
                        rows={2}
                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    )}
                  </div>
                ))}
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            No qualifying questions set up yet — assign an owner and move on, or
            add questions in Settings → Qualifying.
          </p>
        )}

        <div className="space-y-1 border-t pt-3">
          <label className="text-sm font-medium">Assign to</label>
          <SearchPicker
            className="w-full sm:w-72"
            value={owner}
            onChange={setOwner}
            placeholder="— Choose an owner —"
            allowClear
            options={members.map((m) => ({
              value: m.id,
              label: m.name,
              hint: m.title ?? undefined,
            }))}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingText="Saving…" confirm="Qualified & assigned">
            Qualify &amp; assign
          </SubmitButton>
        </div>
      </form>

      <form action={qualifyAndAssign}>
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="owner" value={owner} />
        <input type="hidden" name="skip" value="1" />
        <Button type="submit" variant="ghost" size="sm">
          Skip qualification
        </Button>
      </form>
    </div>
  );
}

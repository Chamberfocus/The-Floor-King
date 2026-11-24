"use client";

import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { SearchPicker } from "@/components/ui/search-picker";

const timeClass =
  "h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Salesperson and optional estimate visit, shared by both add-customer forms.
 * The date is the switch: blank saves the lead only. A day books the visit
 * for the salesperson chosen above (or the person saving the lead).
 */
export function LeadAssignFields({
  assignees,
}: {
  assignees: { id: string; name: string }[];
}) {
  return (
    <>
      {assignees.length ? (
        <div className="space-y-2 sm:col-span-2">
          <Label>Salesperson</Label>
          <SearchPicker
            name="assigned_to"
            allowClear
            placeholder="Choose a salesperson"
            options={assignees.map((person) => ({ value: person.id, label: person.name }))}
          />
          <p className="text-xs text-muted-foreground">
            They own this lead. Leave it blank and the lead stays with you. A salesperson
            accepts it before they write the estimate.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          This lead stays with you.
        </p>
      )}

      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="estimate_date">Estimate visit</Label>
        <p className="text-xs text-muted-foreground">
          Optional. Pick a day to put the visit on the calendar. Leave the day blank to
          save the lead only. This does not text the customer.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Day</span>
            <DateField id="estimate_date" name="estimate_date" />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Arrive</span>
            <input
              type="time"
              name="estimate_time"
              defaultValue="09:00"
              aria-label="Arrive"
              className={timeClass}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Until</span>
            <input
              type="time"
              name="estimate_end"
              defaultValue="11:00"
              aria-label="Until"
              className={timeClass}
            />
          </div>
        </div>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { setJobAddress } from "@/app/(app)/jobs/actions";

/**
 * Which of the customer's addresses this job is at — and a way to add one.
 *
 * The picker only ever offered addresses that already existed, so putting a job
 * at a second property meant leaving the work order, adding it on the customer's
 * file, and coming back. Predictably, almost nobody did: 32 of 36 live jobs
 * carry a street copied off the account rather than a real, reusable job site,
 * which is why two jobs for one landlord looked identical everywhere.
 *
 * Typing one here saves it against the CUSTOMER, so the next job at that
 * property is a dropdown pick.
 */
export function JobSite({
  jobId,
  addresses,
  currentId,
  currentSite,
  /** The job has a street but no saved job site — offer to make it one. */
  looseSite,
}: {
  jobId: string;
  addresses: { id: string; label: string }[];
  currentId: string | null;
  currentSite: string | null;
  looseSite: { street: string; city: string; state: string; zip: string } | null;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {currentSite ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <MapPin className="size-4 text-muted-foreground" />
            {currentSite}
          </span>
        ) : (
          <span className="text-muted-foreground">No site address set.</span>
        )}
      </p>

      {/* A street with no job site behind it can't be reused or told apart from
          the account's billing address. One click makes it a real one. */}
      {looseSite && !currentId ? (
        <form action={setJobAddress} className="rounded-md border border-dashed p-3">
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="new_street" value={looseSite.street} />
          <input type="hidden" name="new_city" value={looseSite.city} />
          <input type="hidden" name="new_state" value={looseSite.state} />
          <input type="hidden" name="new_zip" value={looseSite.zip} />
          <p className="mb-2 text-xs text-muted-foreground">
            This address is typed onto the job, not saved to the customer — so it
            can&apos;t be picked for their next job, and two jobs at two
            properties look the same on every list.
          </p>
          <SubmitButton size="sm" variant="outline" confirm="Saved as a job site">
            <Plus className="size-3.5" /> Save it as a job site
          </SubmitButton>
        </form>
      ) : null}

      <form action={setJobAddress} className="space-y-2">
        <input type="hidden" name="job_id" value={jobId} />

        {!adding ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Which property?
              </label>
              <select
                name="service_address_id"
                defaultValue={currentId ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">Primary address</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton size="sm" variant="outline" confirm="Site updated">
              Update site
            </SubmitButton>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" /> Add a property
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                name="new_label"
                placeholder="Unit / label — e.g. Unit 814"
                className={cn("sm:col-span-2")}
              />
              <Input name="new_street" placeholder="Street" className="sm:col-span-2" />
              <Input name="new_city" placeholder="City" />
              <div className="grid grid-cols-2 gap-2">
                <Input name="new_state" placeholder="State" />
                <Input name="new_zip" placeholder="ZIP" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved to this customer, so their next job at this property is a
              dropdown pick.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <SubmitButton size="sm" confirm="Property added">
                Add &amp; use it
              </SubmitButton>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

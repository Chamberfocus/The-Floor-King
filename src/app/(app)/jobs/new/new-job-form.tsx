"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchPicker } from "@/components/ui/search-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCustomerJobContext,
  createJobForCustomer,
  type CustomerJobContext,
} from "./actions";

const label = "text-xs font-medium text-muted-foreground";
const EMPTY: CustomerJobContext = { addresses: [], estimates: [] };

export function NewJobForm({
  customers,
  preselected,
}: {
  customers: { id: string; full_name: string }[];
  preselected: string | null;
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(preselected ?? "");
  const [title, setTitle] = useState("");
  const [addressId, setAddressId] = useState("");
  const [estimateId, setEstimateId] = useState("");
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState<{ id: string; data: CustomerJobContext } | null>(
    null,
  );
  const [saving, start] = useTransition();

  /**
   * Job sites and un-started estimates belong to the CUSTOMER, so they're
   * fetched once one is picked rather than preloading every address on the books
   * to fill a dropdown that shows three of them.
   *
   * The result is stamped with the customer it came from, so switching accounts
   * shows nothing rather than the previous customer's addresses while the new
   * ones are still in flight.
   */
  useEffect(() => {
    if (!customerId) return;
    let live = true;
    getCustomerJobContext(customerId)
      .then((data) => {
        if (live) setLoaded({ id: customerId, data });
      })
      .catch(() => {
        if (live) setLoaded({ id: customerId, data: EMPTY });
      });
    return () => {
      live = false;
    };
  }, [customerId]);

  const ctx = loaded?.id === customerId ? loaded.data : EMPTY;

  // Whatever was picked belonged to the previous customer.
  const pickCustomer = (v: string) => {
    setCustomerId(v);
    setAddressId("");
    setEstimateId("");
  };

  const submit = () =>
    start(async () => {
      const res = await createJobForCustomer({
        customerId,
        title,
        serviceAddressId: addressId || null,
        estimateId: estimateId || null,
        notes,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Job created");
      router.push(res.jobId ? `/jobs/${res.jobId}?created=1` : "/jobs");
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who&apos;s it for</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchPicker
            value={customerId}
            onChange={pickCustomer}
            placeholder="Search customers…"
            allowClear
            options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Brand-new customer?{" "}
            <Link href="/customers/new" className="text-primary hover:underline">
              Add them first
            </Link>
            , or use{" "}
            <Link href="/jobs/quick" className="text-primary hover:underline">
              Quick install
            </Link>{" "}
            for work that&apos;s already sold with the material in hand.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className={label}>What&apos;s the job? *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Master bedroom + closet carpet"
              className="mt-1"
            />
          </div>

          {ctx.addresses.length ? (
            <div>
              <label className={label}>Job site</label>
              <SearchPicker
                value={addressId}
                onChange={setAddressId}
                placeholder="Their main address"
                allowClear
                options={ctx.addresses.map((a) => ({ value: a.id, label: a.label }))}
              />
            </div>
          ) : null}

          {ctx.estimates.length ? (
            <div>
              <label className={label}>Start from an estimate (optional)</label>
              <SearchPicker
                value={estimateId}
                onChange={setEstimateId}
                placeholder="No estimate — start the job empty"
                allowClear
                options={ctx.estimates.map((e) => ({ value: e.id, label: e.label }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Brings the scope, the accepted option and the costed material
                across, so none of it gets retyped. Estimates that already have a
                work order aren&apos;t listed.
              </p>
            </div>
          ) : null}

          <div>
            <label className={label}>Notes for the crew (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. tear out and haul the old carpet · dog on site · park in the alley"
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="button"
          size="lg"
          onClick={submit}
          disabled={saving || !customerId || !title.trim()}
        >
          <Wrench className="size-4" /> {saving ? "Creating…" : "Create the job"}
        </Button>
      </div>
    </div>
  );
}

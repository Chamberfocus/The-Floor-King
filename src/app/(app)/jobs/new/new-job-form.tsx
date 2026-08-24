"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wrench, Users, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { SearchPicker } from "@/components/ui/search-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getCustomerJobContext,
  createJobForCustomer,
  type CustomerJobContext,
} from "./actions";

const label = "text-xs font-medium text-muted-foreground";
const EMPTY: CustomerJobContext = { addresses: [], estimates: [], liveJobs: [] };
const emptyNc = { full_name: "", phone: "", street: "", city: "", state: "", zip: "" };

/**
 * The one door to a new job.
 *
 * There were three: this page (existing customer, optional estimate), "Quick
 * install" (which could also make the customer, and could book the date), and
 * the customer file's button, which made a work order titled "Job" with nothing
 * on it. Same outcome, three forms, and you had to know which one you were
 * supposed to be in before you started.
 *
 * Everything they each did lives here: existing customer or new one, start from
 * an estimate or don't, book it now or leave it for the scheduler.
 */
export function NewJobForm({
  customers,
  installers,
  windows,
  preselected,
}: {
  customers: { id: string; full_name: string }[];
  installers: { id: string; name: string }[];
  windows: { value: string; label: string }[];
  preselected: string | null;
}) {
  const router = useRouter();
  const [custMode, setCustMode] = useState<"existing" | "new">(
    preselected ? "existing" : "existing",
  );
  const [customerId, setCustomerId] = useState(preselected ?? "");
  const [nc, setNc] = useState(emptyNc);
  const [title, setTitle] = useState("");
  const [addressId, setAddressId] = useState("");
  const [estimateId, setEstimateId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [arrivalWindow, setArrivalWindow] = useState("");
  const [installerId, setInstallerId] = useState("");
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

  const ctx =
    custMode === "existing" && loaded?.id === customerId ? loaded.data : EMPTY;

  // Whatever was picked belonged to the previous customer.
  const pickCustomer = (v: string) => {
    setCustomerId(v);
    setAddressId("");
    setEstimateId("");
  };

  const ready = title.trim() && (custMode === "existing" ? customerId : nc.full_name.trim());

  const submit = () =>
    start(async () => {
      const res = await createJobForCustomer({
        customerId: custMode === "existing" ? customerId || null : null,
        newCustomer: custMode === "new" ? nc : null,
        title,
        serviceAddressId: addressId || null,
        estimateId: estimateId || null,
        scheduledDate: scheduledDate || null,
        arrivalWindow: arrivalWindow || null,
        installerId: installerId || null,
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
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCustMode("existing")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                custMode === "existing"
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted",
              )}
            >
              <Users className="size-4" /> Existing customer
            </button>
            <button
              type="button"
              onClick={() => setCustMode("new")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                custMode === "new"
                  ? "border-primary bg-primary/5 font-medium"
                  : "hover:bg-muted",
              )}
            >
              <UserPlus className="size-4" /> Someone new
            </button>
          </div>

          {custMode === "existing" ? (
            <SearchPicker
              value={customerId}
              onChange={pickCustomer}
              placeholder="Search customers…"
              allowClear
              options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                placeholder="Full name *"
                value={nc.full_name}
                onChange={(e) => setNc({ ...nc, full_name: e.target.value })}
                className="sm:col-span-2"
              />
              <PhoneInput
                placeholder="Phone"
                value={nc.phone}
                onChange={(e) => setNc({ ...nc, phone: e.target.value })}
              />
              <Input
                placeholder="Street"
                value={nc.street}
                onChange={(e) => setNc({ ...nc, street: e.target.value })}
              />
              <Input
                placeholder="City"
                value={nc.city}
                onChange={(e) => setNc({ ...nc, city: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="State"
                  value={nc.state}
                  onChange={(e) => setNc({ ...nc, state: e.target.value })}
                />
                <Input
                  placeholder="ZIP"
                  value={nc.zip}
                  onChange={(e) => setNc({ ...nc, zip: e.target.value })}
                />
              </div>
            </div>
          )}
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

          {/* The account's stage restarts for this job, and an account holds
              only one stage — so if there's other work still running, say what
              that costs rather than letting it happen quietly. */}
          {ctx.liveJobs.length ? (
            <div className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {ctx.liveJobs.length === 1
                  ? "This customer already has a job running"
                  : `This customer already has ${ctx.liveJobs.length} jobs running`}
              </p>
              <ul className="mt-1 list-disc pl-4 text-amber-800/90 dark:text-amber-300/90">
                {ctx.liveJobs.map((j) => (
                  <li key={j.id}>
                    {j.title} <span className="opacity-70">· {j.status}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-amber-800/90 dark:text-amber-300/90">
                Starting this one moves the account back to the beginning of the
                flow for it. Each job keeps its own checklist, but the pipeline
                stage on Client status will follow this new job, not the one
                above.
              </p>
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Book it now?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Leave this empty and the job waits on the Install Scheduler for a date
            — which is the normal way round. Fill it in when the work is sold, the
            material&apos;s in hand and you already know the day.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Install date</label>
              <DateField
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className={label}>Arrival window</label>
              <SearchPicker
                value={arrivalWindow}
                onChange={setArrivalWindow}
                placeholder={scheduledDate ? "Pick a window…" : "Set a date first"}
                allowClear
                options={windows}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Assign installer</label>
              <SearchPicker
                value={installerId}
                onChange={setInstallerId}
                placeholder="Leave open for the board…"
                allowClear
                options={installers.map((i) => ({ value: i.id, label: i.name }))}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Bringing unfinished work over from your old system?{" "}
          <Link href="/carry-over" className="text-primary hover:underline">
            Carry it over instead
          </Link>{" "}
          — that keeps the money you already collected out of this year&apos;s
          profit numbers.
        </p>
        <Button
          type="button"
          size="lg"
          onClick={submit}
          disabled={saving || !ready}
        >
          <Wrench className="size-4" /> {saving ? "Creating…" : "Create the job"}
        </Button>
      </div>
    </div>
  );
}

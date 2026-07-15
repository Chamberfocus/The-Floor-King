"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users, UserPlus, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/utils";
import { createQuickInstall } from "./actions";

const label = "text-xs font-medium text-muted-foreground";
const emptyNc = {
  full_name: "",
  phone: "",
  street: "",
  city: "",
  state: "",
  zip: "",
};

export function QuickInstallForm({
  customers,
  installers,
  windows,
}: {
  customers: { id: string; full_name: string }[];
  installers: { id: string; name: string }[];
  windows: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [custMode, setCustMode] = useState<"existing" | "new">("new");
  const [customerId, setCustomerId] = useState("");
  const [nc, setNc] = useState(emptyNc);
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [arrivalWindow, setArrivalWindow] = useState("");
  const [installerId, setInstallerId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await createQuickInstall({
        customerId: custMode === "existing" ? customerId || null : null,
        newCustomer: custMode === "new" ? nc : null,
        title,
        scheduledDate: scheduledDate || null,
        arrivalWindow: arrivalWindow || null,
        installerId: installerId || null,
        notes,
      });
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Install job created");
      router.push(res.jobId ? `/jobs/${res.jobId}` : "/jobs");
    });

  return (
    <div className="space-y-4">
      {/* Customer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who&apos;s it for</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setCustMode("new")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                custMode === "new" ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
              )}
            >
              <UserPlus className="size-4" /> New
            </button>
            <button
              type="button"
              onClick={() => setCustMode("existing")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                custMode === "existing" ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
              )}
            >
              <Users className="size-4" /> Existing
            </button>
          </div>

          {custMode === "existing" ? (
            <SearchPicker
              value={customerId}
              onChange={setCustomerId}
              placeholder="Search customers…"
              allowClear
              options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="Full name *" value={nc.full_name} onChange={(e) => setNc({ ...nc, full_name: e.target.value })} className="sm:col-span-2" />
              <PhoneInput placeholder="Phone" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
              <Input placeholder="Street" value={nc.street} onChange={(e) => setNc({ ...nc, street: e.target.value })} />
              <Input placeholder="City" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="State" value={nc.state} onChange={(e) => setNc({ ...nc, state: e.target.value })} />
                <Input placeholder="ZIP" value={nc.zip} onChange={(e) => setNc({ ...nc, zip: e.target.value })} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The job */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The install</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className={label}>What&apos;s the work? *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kitchen + hall LVP, 420 sf"
              className="mt-1"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Install date (if set)</label>
              <DateField value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="mt-1" />
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
            <div>
              <label className={label}>Assign installer (optional)</label>
              <SearchPicker
                value={installerId}
                onChange={setInstallerId}
                placeholder="Leave open for the board…"
                allowClear
                options={installers.map((i) => ({ value: i.id, label: i.name }))}
              />
            </div>
          </div>
          <div>
            <label className={label}>Materials to stage / installer notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. 18 boxes Mohawk LVP (in stock), 2 rolls pad · tear out carpet in bedrooms · stairs"
              className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={submit} disabled={saving}>
          <Hammer className="size-4" />{" "}
          {saving ? "Creating…" : "Create install job"}
        </Button>
      </div>
    </div>
  );
}

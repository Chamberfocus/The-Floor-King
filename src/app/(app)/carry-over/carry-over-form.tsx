"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { PhoneInput } from "@/components/ui/phone-input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/lib/types";
import { carryOverDeal, type CarryKind, type CarryOverInput } from "./actions";

const num = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

const KINDS: { value: CarryKind; label: string; hint: string }[] = [
  { value: "estimate_appt", label: "Estimate scheduled (not done yet)", hint: "An appointment is booked to go measure/quote. No price yet." },
  { value: "quoted", label: "Quoted — waiting on answer", hint: "The quote is out; customer hasn't said yes/no." },
  { value: "awaiting_materials", label: "Sold — waiting on materials", hint: "Sold, deposit taken, materials on order." },
  { value: "install_scheduled", label: "Sold — install scheduled", hint: "Sold, install booked, not started yet." },
  { value: "balance_due", label: "Work done — balance due", hint: "Finished; customer still owes a balance." },
];

export function CarryOverForm({
  customers,
  installers,
  salespeople,
}: {
  customers: { id: string; full_name: string }[];
  installers: { id: string; name: string }[];
  salespeople: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(0);

  const [custMode, setCustMode] = useState<"existing" | "new">(
    customers.length ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState("");
  const [salespersonId, setSalespersonId] = useState("");
  const [nc, setNc] = useState({
    full_name: "", phone: "", email: "", street: "", city: "", state: "", zip: "",
    source: "repeat" as LeadSource,
  });

  const [kind, setKind] = useState<CarryKind>("estimate_appt");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [estCost, setEstCost] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [apptAt, setApptAt] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [collected, setCollected] = useState("");
  const [collectedDate, setCollectedDate] = useState("");
  const [method, setMethod] = useState("check");
  const [soldDate, setSoldDate] = useState("");
  const [installerId, setInstallerId] = useState("");
  const [stageNotes, setStageNotes] = useState("");

  const isAppt = kind === "estimate_appt";
  const isSold = kind === "awaiting_materials" || kind === "install_scheduled" || kind === "balance_due";
  const isInstallJob = kind === "awaiting_materials" || kind === "install_scheduled";
  const showMoney = isSold;
  const moneyLabel = kind === "balance_due" ? "Paid so far" : "Deposit collected";
  const balance = num(amount) * (1 + num(taxRate) / 100) - num(collected);

  const resetDeal = () => {
    setTitle(""); setAmount(""); setEstCost(""); setApptAt("");
    setScheduledDate(""); setCollected(""); setCollectedDate(""); setSoldDate("");
    setInstallerId(""); setStageNotes("");
    if (custMode === "new") {
      setNc({ full_name: "", phone: "", email: "", street: "", city: "", state: "", zip: "", source: "repeat" });
    } else setCustomerId("");
  };

  const submit = (another: boolean) =>
    start(async () => {
      if (custMode === "existing" && !customerId) { toast.error("Pick a customer (or switch to Add new)."); return; }
      if (custMode === "new" && !nc.full_name.trim()) { toast.error("Enter the customer's name."); return; }
      if (isAppt && !apptAt) { toast.error("Pick the estimate appointment date & time."); return; }
      if (!isAppt && num(amount) <= 0) { toast.error("Enter the quote / contract amount."); return; }

      const input: CarryOverInput = {
        customerId: custMode === "existing" ? customerId : null,
        newCustomer: custMode === "new" ? nc : null,
        salespersonId: salespersonId || null,
        kind,
        title,
        amount: num(amount),
        estCost: num(estCost),
        taxRate: num(taxRate),
        collected: showMoney ? num(collected) : 0,
        collectedDate: collectedDate || null,
        method,
        soldDate: soldDate || null,
        apptAt: isAppt ? new Date(apptAt).toISOString() : null,
        scheduledDate: isInstallJob ? scheduledDate || null : null,
        installerId: isInstallJob ? installerId || null : null,
        stageNotes: isInstallJob ? stageNotes : "",
      };
      const res = await carryOverDeal(input);
      if (res.error) { toast.error(res.error); return; }
      setDone((d) => d + 1);
      toast.success(`Carried over${another ? " — add another" : ""}`);
      if (another) {
        resetDeal();
        router.refresh();
      } else if (res.customerId) {
        router.push(`/customers/${res.customerId}`);
      }
    });

  const label = "text-xs font-medium text-muted-foreground";

  return (
    <div className="space-y-4 pb-10">
      {done > 0 ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
          ✓ {done} deal{done === 1 ? "" : "s"} carried over so far this session.
        </div>
      ) : null}

      {/* Customer */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <button type="button" onClick={() => setCustMode("existing")}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm", custMode === "existing" ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted")}>
              <Users className="size-4" /> Existing
            </button>
            <button type="button" onClick={() => setCustMode("new")}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm", custMode === "new" ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted")}>
              <UserPlus className="size-4" /> Add new
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
              <Input placeholder="Email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
              <Input placeholder="Street" value={nc.street} onChange={(e) => setNc({ ...nc, street: e.target.value })} className="sm:col-span-2" />
              <Input placeholder="City" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="State" value={nc.state} onChange={(e) => setNc({ ...nc, state: e.target.value })} />
                <Input placeholder="ZIP" value={nc.zip} onChange={(e) => setNc({ ...nc, zip: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Lead source</label>
                <select value={nc.source} onChange={(e) => setNc({ ...nc, source: e.target.value as LeadSource })}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                </select>
              </div>
            </div>
          )}

          <div className="border-t pt-3">
            <label className={label}>Salesperson (owner)</label>
            <SearchPicker
              className="mt-1 w-full sm:w-72"
              value={salespersonId}
              onChange={setSalespersonId}
              placeholder="— Choose the salesperson —"
              allowClear
              options={salespeople.map((s) => ({ value: s.id, label: s.name }))}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              This client stays theirs, and the estimate is credited to them.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* The deal */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Where is this deal?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <select value={kind} onChange={(e) => setKind(e.target.value as CarryKind)}
              className="h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm font-medium">
              {KINDS.map((k) => (<option key={k.value} value={k.value}>{k.label}</option>))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">{KINDS.find((k) => k.value === kind)?.hint}</p>
          </div>

          <div>
            <label className={label}>What's the work?</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kitchen + hall LVP, 420 sf" className="mt-1" />
          </div>

          {isAppt ? (
            <div>
              <label className={label}>Estimate appointment (date &amp; time) *</label>
              <Input type="datetime-local" value={apptAt} onChange={(e) => setApptAt(e.target.value)} className="mt-1 max-w-xs" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <label className={label}>{kind === "quoted" ? "Quote total" : "Contract total"} *</label>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="$" className="mt-1" />
                </div>
                <div>
                  <label className={label}>Your cost (if known)</label>
                  <Input value={estCost} onChange={(e) => setEstCost(e.target.value)} inputMode="decimal" placeholder="$ optional" className="mt-1" />
                </div>
                <div>
                  <label className={label}>Tax %</label>
                  <Input value={taxRate} onChange={(e) => setTaxRate(e.target.value)} inputMode="decimal" placeholder="0" className="mt-1" />
                </div>
              </div>

              {showMoney ? (
                <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                  {kind === "install_scheduled" || kind === "awaiting_materials" ? (
                    <div>
                      <label className={label}>{kind === "install_scheduled" ? "Install date" : "Install date (if set)"}</label>
                      <DateField value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="mt-1 max-w-xs" />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div>
                      <label className={label}>{moneyLabel}</label>
                      <Input value={collected} onChange={(e) => setCollected(e.target.value)} inputMode="decimal" placeholder="$0" className="mt-1" />
                    </div>
                    <div>
                      <label className={label}>Date</label>
                      <DateField value={collectedDate} onChange={(e) => setCollectedDate(e.target.value)} className="mt-1" />
                    </div>
                    <div>
                      <label className={label}>Method</label>
                      <select value={method} onChange={(e) => setMethod(e.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                        <option value="check">Check</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="financing">Financing</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className={label}>Date sold (optional)</label>
                    <DateField value={soldDate} onChange={(e) => setSoldDate(e.target.value)} className="mt-1 max-w-xs" />
                  </div>
                  {num(amount) > 0 ? (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-2 text-sm">
                      <span className="text-muted-foreground">Collected: <span className="font-medium text-foreground">{formatMoney(num(collected))}</span></span>
                      <span className="text-muted-foreground">Balance owed: <span className="font-medium text-foreground">{formatMoney(Math.max(0, balance))}</span></span>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isInstallJob ? (
                <div className="space-y-3 rounded-md border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <div className="text-xs font-semibold text-sky-800 dark:text-sky-300">
                    Crew &amp; warehouse
                  </div>
                  <div>
                    <label className={label}>Assign installer</label>
                    {installers.length ? (
                      <SearchPicker
                        value={installerId}
                        onChange={setInstallerId}
                        placeholder="Pick an installer (optional)…"
                        allowClear
                        options={installers.map((i) => ({ value: i.id, label: i.name }))}
                      />
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No installers on the team yet — add crew logins in Settings → Team.
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      They&apos;ll see this job under their <span className="font-medium">Jobs</span>.
                    </p>
                  </div>
                  <div>
                    <label className={label}>Materials to stage / installer notes</label>
                    <textarea
                      value={stageNotes}
                      onChange={(e) => setStageNotes(e.target.value)}
                      rows={2}
                      placeholder={'e.g. 3 boxes Shaw LVP 7" + T-molding, pad for stairs'}
                      className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Shows on the warehouse card and the installer&apos;s job. No PO or
                      inventory is touched.
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={pending} onClick={() => submit(true)}>
          <Save className="size-4" /> {pending ? "Saving…" : "Save & add another"}
        </Button>
        <Button type="button" disabled={pending} onClick={() => submit(false)}>
          <Save className="size-4" /> Save & open customer
        </Button>
      </div>
    </div>
  );
}

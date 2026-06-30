"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedField } from "@/components/ui/segmented-field";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { LEAD_SOURCE_LABELS, type LeadSource } from "@/lib/types";
import { carryOverDeal, type CarryOverInput } from "./actions";

const num = (v: string) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

export function CarryOverForm({
  customers,
}: {
  customers: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(0);

  const [custMode, setCustMode] = useState<"existing" | "new">(
    customers.length ? "existing" : "new",
  );
  const [customerId, setCustomerId] = useState("");
  const [nc, setNc] = useState({
    full_name: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    source: "repeat" as LeadSource,
  });

  const [kind, setKind] = useState<"estimate" | "install">("estimate");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [estCost, setEstCost] = useState("");
  const [taxRate, setTaxRate] = useState("");

  const [jobStatus, setJobStatus] = useState<
    "scheduled" | "in_progress" | "unscheduled"
  >("scheduled");
  const [scheduledDate, setScheduledDate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [depositDate, setDepositDate] = useState("");
  const [depositMethod, setDepositMethod] = useState("check");
  const [soldDate, setSoldDate] = useState("");

  const isInstall = kind === "install";
  const balance = num(amount) - num(deposit);

  const resetDeal = () => {
    setTitle("");
    setAmount("");
    setEstCost("");
    setScheduledDate("");
    setDeposit("");
    setDepositDate("");
    setSoldDate("");
    if (custMode === "new") {
      setNc({
        full_name: "",
        phone: "",
        email: "",
        street: "",
        city: "",
        state: "",
        zip: "",
        source: "repeat",
      });
    } else {
      setCustomerId("");
    }
  };

  const submit = (another: boolean) =>
    start(async () => {
      if (custMode === "existing" && !customerId) {
        toast.error("Pick a customer (or switch to Add new).");
        return;
      }
      if (custMode === "new" && !nc.full_name.trim()) {
        toast.error("Enter the customer's name.");
        return;
      }
      if (num(amount) <= 0) {
        toast.error("Enter the quote / contract amount.");
        return;
      }
      const input: CarryOverInput = {
        customerId: custMode === "existing" ? customerId : null,
        newCustomer: custMode === "new" ? nc : null,
        kind,
        title,
        amount: num(amount),
        estCost: num(estCost),
        taxRate: num(taxRate),
        depositCollected: isInstall ? num(deposit) : 0,
        depositDate: depositDate || null,
        depositMethod,
        soldDate: soldDate || null,
        scheduledDate: isInstall ? scheduledDate || null : null,
        jobStatus,
      };
      const res = await carryOverDeal(input);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setDone((d) => d + 1);
      toast.success(
        `Carried over ${isInstall ? "install" : "estimate"}${another ? " — add another" : ""}`,
      );
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
            <button
              type="button"
              onClick={() => setCustMode("new")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm",
                custMode === "new" ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
              )}
            >
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
              <Input
                placeholder="Full name *"
                value={nc.full_name}
                onChange={(e) => setNc({ ...nc, full_name: e.target.value })}
                className="sm:col-span-2"
              />
              <Input placeholder="Phone" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} />
              <Input placeholder="Email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} />
              <Input placeholder="Street" value={nc.street} onChange={(e) => setNc({ ...nc, street: e.target.value })} className="sm:col-span-2" />
              <Input placeholder="City" value={nc.city} onChange={(e) => setNc({ ...nc, city: e.target.value })} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="State" value={nc.state} onChange={(e) => setNc({ ...nc, state: e.target.value })} />
                <Input placeholder="ZIP" value={nc.zip} onChange={(e) => setNc({ ...nc, zip: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>Lead source</label>
                <select
                  value={nc.source}
                  onChange={(e) => setNc({ ...nc, source: e.target.value as LeadSource })}
                  className="mt-1 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {Object.entries(LEAD_SOURCE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* The deal */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Where is this deal?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <SegmentedField
            value={kind}
            onChange={(v) => setKind(v as "estimate" | "install")}
            options={[
              { value: "estimate", label: "Open estimate (quoted)" },
              { value: "install", label: "Sold install (in progress)" },
            ]}
          />

          <div>
            <label className={label}>What's the work?</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Kitchen + hall LVP, 420 sf"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>{isInstall ? "Contract total" : "Quote total"} *</label>
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

          {isInstall ? (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Install status</label>
                  <select
                    value={jobStatus}
                    onChange={(e) => setJobStatus(e.target.value as typeof jobStatus)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In progress</option>
                    <option value="unscheduled">Not scheduled yet</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Scheduled date</label>
                  <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className="mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <label className={label}>Deposit already collected</label>
                  <Input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" placeholder="$0" className="mt-1" />
                </div>
                <div>
                  <label className={label}>Deposit date</label>
                  <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className={label}>Method</label>
                  <select
                    value={depositMethod}
                    onChange={(e) => setDepositMethod(e.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  >
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
                <Input type="date" value={soldDate} onChange={(e) => setSoldDate(e.target.value)} className="mt-1 max-w-xs" />
              </div>
              {num(amount) > 0 ? (
                <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-2 text-sm">
                  <span className="text-muted-foreground">
                    Collected: <span className="font-medium text-foreground">{formatMoney(num(deposit))}</span>
                  </span>
                  <span className="text-muted-foreground">
                    Balance owed: <span className="font-medium text-foreground">{formatMoney(Math.max(0, balance))}</span>
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
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

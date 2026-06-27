"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Phone, Mail, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { InstallCrew, CrewPayout } from "@/lib/data/install-crews";
import { saveInstallCrew, setInstallCrewActive } from "./actions";

const BASIS_LABEL: Record<string, string> = {
  flat: "flat / job",
  per_sqft: "per sq ft",
  per_sqyd: "per sq yd",
  percent: "% of labor",
};

export function InstallCrewsManager({
  initial,
  payouts = {},
}: {
  initial: InstallCrew[];
  payouts?: Record<string, CrewPayout>;
}) {
  const [editing, setEditing] = useState<InstallCrew | "new" | null>(null);
  const [pending, start] = useTransition();

  const totalUnpaid = initial.reduce((s, c) => s + (payouts[c.id]?.unpaid ?? 0), 0);

  const onSave = (form: FormData) =>
    start(async () => {
      const res = await saveInstallCrew(form);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Saved");
        setEditing(null);
      }
    });

  const toggleActive = (c: InstallCrew) =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", c.id);
      fd.set("active", String(!c.active));
      const res = await setInstallCrewActive(fd);
      if (res.error) toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      {totalUnpaid > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="font-semibold text-amber-700">
            {formatMoney(totalUnpaid)} outstanding
          </span>
          <span className="text-amber-800"> to your crews — unpaid recorded payouts across all jobs.</span>
        </div>
      ) : null}

      {editing ? (
        <CrewForm
          crew={editing === "new" ? null : editing}
          pending={pending}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <Button type="button" onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add a crew
        </Button>
      )}

      {initial.length === 0 && !editing ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No crews yet. Add your install crews — they&apos;ll show up when you
          assign a crew on a job.
        </p>
      ) : null}

      <div className="space-y-2">
        {initial.map((c) => (
          <Card key={c.id} className={cn(!c.active && "opacity-60")}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  {c.name}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                    {c.kind === "employee" ? "Employee" : "Subcontractor"}
                  </span>
                  {!c.active ? (
                    <span className="text-[11px] text-amber-600">inactive</span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {c.phone ? (
                    <span className="flex items-center gap-1">
                      <Phone className="size-3" /> {c.phone}
                    </span>
                  ) : null}
                  {c.email ? (
                    <span className="flex items-center gap-1">
                      <Mail className="size-3" /> {c.email}
                    </span>
                  ) : null}
                  {c.pay_rate != null ? (
                    <span>
                      {formatMoney(c.pay_rate)} {BASIS_LABEL[c.pay_basis ?? ""] ?? c.pay_basis}
                    </span>
                  ) : null}
                </div>
                {payouts[c.id] && payouts[c.id].total > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Paid {formatMoney(payouts[c.id].paid)}
                    </span>
                    {payouts[c.id].unpaid > 0 ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600">
                        {formatMoney(payouts[c.id].unpaid)} unpaid
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600">
                        all paid
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      · {payouts[c.id].jobs} job{payouts[c.id].jobs === 1 ? "" : "s"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(c)}>
                  <Pencil className="size-3.5" /> Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => toggleActive(c)}
                >
                  {c.active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CrewForm({
  crew,
  pending,
  onSave,
  onCancel,
}: {
  crew: InstallCrew | null;
  pending: boolean;
  onSave: (fd: FormData) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState(crew?.kind ?? "subcontractor");
  const [basis, setBasis] = useState(crew?.pay_basis ?? "");

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={onSave} className="space-y-3">
          {crew ? <input type="hidden" name="id" value={crew.id} /> : null}
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="pay_basis" value={basis} />

          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{crew ? "Edit crew" : "New crew"}</h3>
            <button type="button" onClick={onCancel} aria-label="Close">
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Crew name *</label>
            <Input name="name" defaultValue={crew?.name ?? ""} placeholder="e.g. Mike's Hardwood Crew" required />
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Type</label>
            <div className="flex gap-1">
              {(["subcontractor", "employee"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm capitalize",
                    kind === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Phone</label>
              <Input name="phone" defaultValue={crew?.phone ?? ""} placeholder="216-555-0101" inputMode="tel" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Email</label>
              <Input name="email" defaultValue={crew?.email ?? ""} placeholder="crew@example.com" inputMode="email" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Default pay rate (optional) — pre-fills the payout on a job
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                name="pay_rate"
                defaultValue={crew?.pay_rate != null ? String(crew.pay_rate) : ""}
                placeholder="rate"
                inputMode="decimal"
                className="w-28"
              />
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["", "—"],
                    ["per_sqft", "per sq ft"],
                    ["per_sqyd", "per sq yd"],
                    ["flat", "flat / job"],
                    ["percent", "% of labor"],
                  ] as [string, string][]
                ).map(([v, lbl]) => (
                  <button
                    key={v || "none"}
                    type="button"
                    onClick={() => setBasis(v)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      basis === v ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Notes</label>
            <Input name="notes" defaultValue={crew?.notes ?? ""} placeholder="Specialties, crew size, etc." />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save crew"}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

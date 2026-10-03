"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approveTrueUp,
  correctSalesperson,
  overrideCollection,
  overrideCommission,
  reopenTrueUp,
  saveTrueUpCost,
} from "./actions";

const CATEGORIES = [
  ["material", "Material"],
  ["labor", "Labor"],
  ["freight", "Freight"],
  ["other", "Other direct cost"],
] as const;

export function TrueUpPanel({
  jobId,
  canEnter,
  canApprove,
  canOverride,
  canCollection,
  canSalesperson,
  approved,
  revisionOpen,
  salespeople,
}: {
  jobId: string;
  canEnter: boolean;
  canApprove: boolean;
  canOverride: boolean;
  canCollection: boolean;
  canSalesperson: boolean;
  approved: boolean;
  revisionOpen: boolean;
  salespeople: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("freight");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const run = (work: () => Promise<{ ok: boolean; error?: string; detail?: string }>) => {
    start(async () => {
      const result = await work();
      if (!result.ok) toast.error(result.error ?? "Something went wrong.");
      else toast.success(result.detail ? `Saved (${result.detail}).` : "Saved.");
    });
  };

  if (!canEnter && !canApprove && !canOverride) return null;
  const costsOpen = !approved || revisionOpen;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canEnter && costsOpen ? (
        <section className="rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold">Actual cost</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use this when the job has no automatic cost, or to confirm a real zero. The original estimate is left alone.
          </p>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm">
              Category
              <select
                className="h-11 rounded-lg border bg-transparent px-3"
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Amount
              <Input className="h-11" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </label>
            <label className="grid gap-1 text-sm">
              Reason
              <Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm">
              Note
              <Input className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="h-11"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    saveTrueUpCost({
                      jobId,
                      category,
                      kind: "manual_amount",
                      amount,
                      reason,
                      note,
                    }),
                  )
                }
              >
                Save amount
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    saveTrueUpCost({
                      jobId,
                      category,
                      kind: "confirm_zero",
                      amount: "0",
                      reason,
                      note,
                    }),
                  )
                }
              >
                Confirm $0
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border bg-card p-4">
        <h2 className="text-base font-semibold">Approval and commission</h2>
        <div className="mt-3 flex flex-col gap-3">
          {canApprove && (!approved || revisionOpen) ? (
            <Button type="button" className="h-11" disabled={pending} onClick={() => run(() => approveTrueUp(jobId))}>
              {revisionOpen ? "Approve revised calculation" : "Approve true-up"}
            </Button>
          ) : null}
          {canApprove && approved && !revisionOpen ? (
            <div className="grid gap-2">
              <Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this true-up needs another look" />
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={pending}
                onClick={() => run(() => reopenTrueUp(jobId, reason))}
              >
                Reopen for revision
              </Button>
            </div>
          ) : null}
          {canSalesperson ? (
            <SalespersonForm
              people={salespeople}
              pending={pending}
              onSave={(salespersonId, why) =>
                run(() => correctSalesperson({ jobId, salespersonId, reason: why }))
              }
            />
          ) : null}
          {canCollection ? (
            <ReasonButton
              label="Override collection requirement"
              pending={pending}
              onSave={(why) => run(() => overrideCollection(jobId, why))}
            />
          ) : null}
          {canOverride && costsOpen ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Administrator commission override</p>
              <OverrideRow
                label="Commissionable gross profit"
                pending={pending}
                onSave={(value, why) => run(() => overrideCommission({ jobId, field: "gp", value, reason: why }))}
              />
              <OverrideRow
                label="Commission rate percent"
                pending={pending}
                onSave={(value, why) => run(() => overrideCommission({ jobId, field: "rate", value, reason: why }))}
              />
              <OverrideRow
                label="Commission amount"
                pending={pending}
                onSave={(value, why) => run(() => overrideCommission({ jobId, field: "amount", value, reason: why }))}
              />
              <ReasonButton
                label="Acknowledge zero revenue"
                pending={pending}
                onSave={(why) => run(() => overrideCommission({ jobId, field: "zero_revenue", value: "0", reason: why }))}
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function SalespersonForm({
  people,
  pending,
  onSave,
}: {
  people: { id: string; name: string }[];
  pending: boolean;
  onSave: (id: string, reason: string) => void;
}) {
  const [id, setId] = useState(people[0]?.id ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-2">
      <select className="h-11 rounded-lg border bg-transparent px-3" value={id} onChange={(e) => setId(e.target.value)}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the salesperson change" />
      <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => onSave(id, reason)}>
        Correct salesperson
      </Button>
    </div>
  );
}

function ReasonButton({
  label,
  pending,
  onSave,
}: {
  label: string;
  pending: boolean;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-2">
      <Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => onSave(reason)}>
        {label}
      </Button>
    </div>
  );
}

function OverrideRow({
  label,
  pending,
  onSave,
}: {
  label: string;
  pending: boolean;
  onSave: (value: string, reason: string) => void;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <Input className="h-11" value={value} onChange={(e) => setValue(e.target.value)} placeholder={label} />
      <Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => onSave(value, reason)}>
        Override
      </Button>
    </div>
  );
}

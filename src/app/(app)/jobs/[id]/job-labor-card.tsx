"use client";

import { useState } from "react";
import { Trash2, Check, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { SegmentedField } from "@/components/ui/segmented-field";
import { formatMoney } from "@/lib/format";
import { LABOR_BASIS_LABELS, type JobLabor, type LaborBasis } from "@/lib/types";
import { addJobLabor, toggleJobLaborPaid, deleteJobLabor } from "../actions";

export function JobLaborCard({
  jobId,
  rows,
  crew,
}: {
  jobId: string;
  rows: JobLabor[];
  crew?: {
    id: string;
    name: string;
    pay_basis: string | null;
    pay_rate: number | null;
  } | null;
}) {
  // Pre-fill from the assigned crew's defaults (still fully editable).
  const crewBasis: LaborBasis =
    crew?.pay_basis === "per_sqft" || crew?.pay_basis === "per_sqyd" || crew?.pay_basis === "flat"
      ? crew.pay_basis
      : "flat";
  const [basis, setBasis] = useState<LaborBasis>(crewBasis);
  const [rate, setRate] = useState(
    crew?.pay_rate != null && crewBasis !== "flat" ? String(crew.pay_rate) : "",
  );
  const [area, setArea] = useState("");

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const unpaid = rows
    .filter((r) => !r.paid)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const computed =
    basis === "flat"
      ? null
      : (parseFloat(rate || "0") || 0) * (parseFloat(area || "0") || 0);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">
          Crew pay notes (legacy — not actual job cost) — {formatMoney(total)}
          {unpaid > 0 ? (
            <span className="ml-2 text-sm font-normal text-amber-600">
              {formatMoney(unpaid)} unpaid
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          Actual installation labor cost is managed on the{" "}
          <a className="font-medium text-foreground underline" href={`/jobs/${jobId}/bill`}>
            installer bill
          </a>
          . These crew-pay notes do not feed job profitability or AP.
        </p>
        {rows.length > 0 ? (
          <div className="divide-y rounded-md border">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{r.payee || "Crew"}</span>
                  <span className="ml-2 text-muted-foreground">
                    {r.basis === "flat"
                      ? "flat"
                      : `${formatMoney(r.rate)}/${
                          r.basis === "per_sqft" ? "sf" : "yd"
                        } × ${r.area}`}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </div>
                <span className="font-semibold">{formatMoney(r.amount)}</span>
                <span
                  className={
                    r.paid
                      ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600"
                      : "rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600"
                  }
                >
                  {r.paid ? `Paid${r.paid_on ? ` ${r.paid_on}` : ""}` : "Unpaid"}
                </span>
                <form action={toggleJobLaborPaid}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="job_id" value={jobId} />
                  <input type="hidden" name="paid" value={String(r.paid)} />
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    title={r.paid ? "Mark unpaid" : "Mark paid"}
                  >
                    <Check className="size-4" />
                  </Button>
                </form>
                <form action={deleteJobLabor}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="job_id" value={jobId} />
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    aria-label="Remove"
                    title={`Delete the ${formatMoney(r.amount)} pay line for ${r.payee || "this crew"}?`}
                    description="This removes the payout record from the job. This can't be undone."
                    confirmLabel="Delete pay line"
                    destructive
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </ConfirmButton>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No crew pay notes yet. Prefer the installer bill for actual labor cost.
          </p>
        )}

        {/* Add a payout */}
        <form action={addJobLabor} className="space-y-3 border-t pt-4">
          <input type="hidden" name="job_id" value={jobId} />
          {crew ? <input type="hidden" name="crew_id" value={crew.id} /> : null}
          {crew ? (
            <p className="rounded-md bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground">
              Pre-filled from the assigned crew{" "}
              <span className="font-medium text-foreground">{crew.name}</span> — adjust if needed.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Crew / installer
              </label>
              <Input name="payee" defaultValue={crew?.name ?? ""} placeholder="e.g. Mike's crew" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">How paid</label>
              <SegmentedField
                name="basis"
                value={basis}
                onChange={(v) => setBasis(v as LaborBasis)}
                options={(Object.keys(LABOR_BASIS_LABELS) as LaborBasis[]).map(
                  (b) => ({ value: b, label: LABOR_BASIS_LABELS[b] }),
                )}
              />
            </div>
          </div>

          {basis === "flat" ? (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Amount paid
              </label>
              <Input
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={
                  crew?.pay_rate != null && crewBasis === "flat" ? String(crew.pay_rate) : ""
                }
                className="max-w-40"
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Rate / {basis === "per_sqft" ? "sq ft" : "sq yd"}
                </label>
                <Input
                  name="rate"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-28"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {basis === "per_sqft" ? "Sq ft" : "Sq yd"}
                </label>
                <Input
                  name="area"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="w-28"
                />
              </div>
              <div className="pb-2 text-sm text-muted-foreground">
                = <span className="font-semibold text-foreground">
                  {formatMoney(computed)}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="paid"
                className="size-4 rounded border-input"
              />
              Already paid
            </label>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Paid on (if paid)
              </label>
              <DateField name="paid_on" className="w-44" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Note</label>
            <Input name="note" placeholder="optional" />
          </div>

          <Button type="submit">
            <Plus className="size-4" /> Add crew pay
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, X, TriangleAlert, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { saveCloseout, type IssueInput } from "./actions";

const SELECT =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm";
const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const ISSUE_CODES: { value: string; label: string }[] = [
  { value: "bad_measure", label: "Bad measure — short or long" },
  { value: "material_shortage", label: "Ran out of material" },
  { value: "material_wrong", label: "Wrong material — colour, style, lot" },
  { value: "material_damaged", label: "Material damaged" },
  { value: "installer_rework", label: "Had to redo work" },
  { value: "customer_change", label: "Customer changed the scope" },
  { value: "subfloor_condition", label: "Subfloor worse than expected" },
  { value: "access_delay", label: "Couldn't get in / access delay" },
  { value: "scheduling", label: "Scheduling fell through" },
  { value: "pricing_error", label: "Priced it wrong" },
  { value: "other", label: "Something else" },
];

const BLAME: { value: string; label: string }[] = [
  { value: "unknown", label: "Not sure" },
  { value: "sales", label: "Sales" },
  { value: "installer", label: "Installer" },
  { value: "supplier", label: "Supplier" },
  { value: "warehouse", label: "Warehouse" },
  { value: "customer", label: "Customer" },
  { value: "us", label: "Us — nobody in particular" },
];

interface Row extends IssueInput {
  key: string;
}

const num = (v: string | number | null) => {
  if (v === null || String(v).trim() === "") return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export function CloseoutForm({
  jobId,
  estMaterial,
  estLabor,
  suggested,
  people,
  suppliers,
  existing,
  existingNotes,
  alreadyClosed,
}: {
  jobId: string;
  estMaterial: number;
  estLabor: number;
  suggested: {
    material: number | null;
    labor: number | null;
    materialSource: string;
    laborSource: string;
  };
  people: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  existing: (IssueInput & { id: string })[];
  existingNotes: string;
  alreadyClosed: boolean;
}) {
  const [material, setMaterial] = useState(
    existing.length || alreadyClosed ? "" : "",
  );
  const [labor, setLabor] = useState("");
  const [other, setOther] = useState("");
  const [notes, setNotes] = useState(existingNotes);
  const [rows, setRows] = useState<Row[]>(
    existing.map((e, i) => ({ ...e, key: `e${i}` })),
  );
  const [saving, start] = useTransition();

  const estTotal = estMaterial + estLabor;
  const actualTotal = num(material) + num(labor) + num(other);
  const anyEntered =
    material.trim() !== "" || labor.trim() !== "" || other.trim() !== "";
  const variance = actualTotal - estTotal;
  const issueCost = rows.reduce((s, r) => s + num(r.costImpact), 0);

  const patch = (key: string, p: Partial<Row>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const usePrefill = () => {
    if (suggested.material != null) setMaterial(String(suggested.material));
    if (suggested.labor != null) setLabor(String(suggested.labor));
    toast.success("Filled in from the records — change anything that's off.");
  };

  const submit = () =>
    start(async () => {
      const res = await saveCloseout({
        jobId,
        actualMaterial: material,
        actualLabor: labor,
        actualOther: other,
        notes,
        issues: rows,
      });
      if (res?.error) toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What it actually cost</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {suggested.material != null || suggested.labor != null ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-2 text-sm">
              <Wand2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 text-muted-foreground">
                Records suggest{" "}
                {suggested.material != null
                  ? `${formatMoney(suggested.material)} material (${suggested.materialSource})`
                  : `no material figure — ${suggested.materialSource}`}
                {", "}
                {suggested.labor != null
                  ? `${formatMoney(suggested.labor)} labor (${suggested.laborSource})`
                  : `no labor figure — ${suggested.laborSource}`}
                .
              </span>
              <Button type="button" variant="outline" size="sm" onClick={usePrefill}>
                Use these
              </Button>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">
              Nothing to pre-fill from — {suggested.materialSource}, and{" "}
              {suggested.laborSource}. Type the real numbers below.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["Material", material, setMaterial, estMaterial],
                ["Labor", labor, setLabor, estLabor],
                ["Other — dump, fuel, store runs", other, setOther, null],
              ] as const
            ).map(([label, value, set, est]) => (
              <div key={label}>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {label}
                </label>
                <Input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder="0.00"
                />
                {est != null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    estimated {formatMoney(est)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {/* The comparison, spelled out. */}
          <div
            className={cn(
              "rounded-md border p-3 text-sm",
              !anyEntered
                ? "bg-muted/30"
                : variance > 0
                  ? "border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40"
                  : "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40",
            )}
          >
            {!anyEntered ? (
              <span className="text-muted-foreground">
                Enter at least one cost and the comparison shows here.
              </span>
            ) : (
              <>
                <div className="flex justify-between gap-4 tabular-nums">
                  <span className="text-muted-foreground">Estimated cost</span>
                  <span>{formatMoney(estTotal)}</span>
                </div>
                <div className="flex justify-between gap-4 tabular-nums">
                  <span className="text-muted-foreground">Actual cost</span>
                  <span>{formatMoney(actualTotal)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-4 border-t pt-1 font-semibold tabular-nums">
                  <span>{variance > 0 ? "Over by" : "Under by"}</span>
                  <span>
                    {formatMoney(Math.abs(variance))}
                    {estTotal > 0
                      ? ` · ${((Math.abs(variance) / estTotal) * 100).toFixed(1)}%`
                      : ""}
                  </span>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            What went wrong
            {rows.length ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {rows.length} · {formatMoney(issueCost)} of it
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Pick a reason so it adds up across jobs — &ldquo;bad measure cost us
            $4,200 across nine jobs&rdquo; is something you can act on; a pile of
            notes isn&apos;t.
          </p>

          {rows.map((r) => (
            <div key={r.key} className="rounded-md border p-3">
              <div className="flex items-start gap-2">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      What happened
                    </label>
                    <select
                      value={r.code}
                      onChange={(e) => patch(r.key, { code: e.target.value })}
                      className={SELECT}
                    >
                      {ISSUE_CODES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Down to
                    </label>
                    <select
                      value={r.blame}
                      onChange={(e) =>
                        patch(r.key, {
                          blame: e.target.value,
                          blameProfileId: null,
                          blameSupplierId: null,
                        })
                      }
                      className={SELECT}
                    >
                      {BLAME.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {r.blame === "sales" || r.blame === "installer" ? (
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Who
                      </label>
                      <select
                        value={r.blameProfileId ?? ""}
                        onChange={(e) =>
                          patch(r.key, { blameProfileId: e.target.value || null })
                        }
                        className={SELECT}
                      >
                        <option value="">Not saying</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {r.blame === "supplier" ? (
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Which supplier
                      </label>
                      <select
                        value={r.blameSupplierId ?? ""}
                        onChange={(e) =>
                          patch(r.key, { blameSupplierId: e.target.value || null })
                        }
                        className={SELECT}
                      >
                        <option value="">Not saying</option>
                        {suppliers.map((sup) => (
                          <option key={sup.id} value={sup.id}>
                            {sup.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      What it cost
                    </label>
                    <Input
                      inputMode="decimal"
                      value={String(r.costImpact ?? "")}
                      onChange={(e) => patch(r.key, { costImpact: e.target.value })}
                      placeholder="0.00 — leave blank if it only cost time"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove"
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                >
                  <X className="size-4" />
                </Button>
              </div>

              <Input
                value={r.note}
                onChange={(e) => patch(r.key, { note: e.target.value })}
                placeholder="What happened, in your words"
                className="mt-2"
              />
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRows([
                ...rows,
                {
                  key: `k${Date.now()}${rows.length}`,
                  code: "bad_measure",
                  blame: "unknown",
                  blameProfileId: null,
                  blameSupplierId: null,
                  costImpact: "",
                  note: "",
                },
              ])
            }
          >
            <Plus className="size-4" />
            {rows.length ? "Another problem" : "Log a problem"}
          </Button>

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Anything else worth remembering
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={TEXTAREA}
              placeholder="How it went, what you'd do differently…"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={saving || !anyEntered} size="lg">
          <TriangleAlert className="size-4" />
          {saving ? "Saving…" : alreadyClosed ? "Update close-out" : "Close the job out"}
        </Button>
        {!anyEntered ? (
          <span className="text-sm text-muted-foreground">
            Enter at least one actual cost first.
          </span>
        ) : null}
      </div>
    </div>
  );
}

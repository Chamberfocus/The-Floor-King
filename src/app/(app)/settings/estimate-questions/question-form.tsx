"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createEstimateQuestion,
  updateEstimateQuestion,
  type EQFormState,
} from "./actions";
import type { EstimateQuestion, EstimateQuestionKind } from "@/lib/types";

const initial: EQFormState = { error: null };

const KINDS: { value: EstimateQuestionKind; label: string; hint: string }[] = [
  { value: "areas", label: "Areas / measurements", hint: "List rooms with sizes — feeds all quantities" },
  { value: "product", label: "Catalog product", hint: "Pick a real product → material line" },
  { value: "yesno", label: "Yes / No", hint: "Toggle → optionally adds a line" },
  { value: "number", label: "Number / count", hint: "Amount × rate → a line" },
  { value: "choice", label: "Choice", hint: "Options, each can add a line" },
  { value: "text", label: "Text note", hint: "Free text → job notes" },
];
const CATEGORIES = ["carpet", "underlayment", "lvp", "hardwood", "laminate", "tile", "vinyl", "trim", "other"];
const UNITS = ["sqft", "sqyd", "lnft", "each", "step", "flat"];

const label = "mb-1 block text-xs font-medium text-muted-foreground";
const field = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function QuestionForm({ question }: { question?: EstimateQuestion }) {
  const router = useRouter();
  const editing = !!question;
  const action = editing ? updateEstimateQuestion : createEstimateQuestion;
  const [state, formAction, pending] = useActionState(action, initial);
  const [kind, setKind] = useState<EstimateQuestionKind>(question?.kind ?? "yesno");
  const c = question?.config ?? {};
  const e = c.emit ?? null;

  useEffect(() => {
    if (state.ok) {
      toast.success(editing ? "Question saved" : "Question added");
      router.push("/settings/estimate-questions");
      router.refresh();
    }
  }, [state.ok, editing, router]);

  return (
    <form action={formAction} className="space-y-4">
      {editing ? <input type="hidden" name="id" value={question.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>Question</label>
          <Input name="label" defaultValue={question?.label} placeholder="e.g. Tear up the old floor?" required />
        </div>
        <div>
          <label className={label}>Section</label>
          <Input name="section" defaultValue={question?.section ?? "Carpet"} placeholder="Carpet" />
        </div>
        <div>
          <label className={label}>Order (position)</label>
          <Input name="position" type="number" defaultValue={question?.position ?? 0} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Help text (optional)</label>
          <Input name="help" defaultValue={question?.help ?? ""} placeholder="A hint shown under the question" />
        </div>
        <div>
          <label className={label}>Answer type</label>
          <select name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as EstimateQuestionKind)} className={field}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">{KINDS.find((k) => k.value === kind)?.hint}</p>
        </div>
        <div className="flex items-end gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="required" defaultChecked={question?.required} className="size-4" /> Required
          </label>
          {editing ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={question.active} className="size-4" /> Active
            </label>
          ) : null}
        </div>
      </div>

      {/* Kind-specific mapping */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          How the answer builds the estimate
        </div>

        {kind === "areas" ? (
          <p className="text-sm text-muted-foreground">Collects rooms + measurements. This area feeds the quantity of carpet, pad, and area-based labor. No extra setup.</p>
        ) : null}
        {kind === "text" ? (
          <p className="text-sm text-muted-foreground">The answer is added to the job notes shown on the work order.</p>
        ) : null}

        {kind === "product" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Catalog category</label>
              <select name="cfg_category" defaultValue={c.category ?? "carpet"} className={field}>
                {CATEGORIES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" name="cfg_ask_source" defaultChecked={c.ask_source ?? true} className="size-4" />
              Ask Stock vs Order (+ vendor)
            </label>
            <p className="sm:col-span-2 text-xs text-muted-foreground">Renders a catalog picker for this category and adds a material line, with the correct unit (carpet &amp; pad in sq yd) and price. Install labor comes in automatically when the product carries a labor rate.</p>
          </div>
        ) : null}

        {kind === "yesno" || kind === "number" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {kind === "yesno" ? (
              <label className="flex items-center gap-2 pb-2 text-sm sm:col-span-3">
                <input type="checkbox" name="cfg_default" defaultChecked={c.default} className="size-4" /> Pre-select &ldquo;Yes&rdquo;
              </label>
            ) : null}
            <div>
              <label className={label}>Adds a…</label>
              <select name="emit_role" defaultValue={e?.role ?? "labor"} className={field}>
                <option value="labor">Labor line</option>
                <option value="material">Material line (→ PO)</option>
              </select>
            </div>
            <div>
              <label className={label}>Category</label>
              <Input name="emit_category" defaultValue={e?.category ?? "labor"} />
            </div>
            <div>
              <label className={label}>Unit</label>
              <select name="emit_unit" defaultValue={e?.unit ?? (kind === "number" ? "each" : "flat")} className={field}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={label}>Line description</label>
              <Input name="emit_description" defaultValue={e?.description ?? ""} placeholder="e.g. Tear-out (old floor)" />
            </div>
            <div>
              <label className={label}>Cost (our $/unit)</label>
              <Input name="emit_cost" type="number" step="0.01" defaultValue={e?.cost ?? 0} />
            </div>
            {kind === "yesno" ? (
              <div>
                <label className={label}>Quantity from</label>
                <select name="emit_per" defaultValue={e?.per ?? "area"} className={field}>
                  <option value="area">Measured area</option>
                  <option value="flat">Flat (qty 1)</option>
                  <option value="each">Each (qty 1)</option>
                </select>
              </div>
            ) : (
              <>
                <input type="hidden" name="emit_per" value="each" />
                <div className="sm:col-span-3">
                  <label className={label}>Rate options (optional) — one per line, &ldquo;Label | cost&rdquo;</label>
                  <textarea name="rate_options" rows={2} defaultValue={(c.rate_options ?? []).map((r) => `${r.label} | ${r.cost}`).join("\n")}
                    placeholder={"Regular steps | 18\nHollywood steps | 28"}
                    className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm" />
                </div>
              </>
            )}
          </div>
        ) : null}

        {kind === "choice" ? (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="cfg_multi" defaultChecked={c.multi} className="size-4" /> Allow multiple selections
            </label>
            <div>
              <label className={label}>Options — one per line: &ldquo;Label | cost | line description&rdquo; (cost 0 = no line)</label>
              <textarea name="options" rows={4}
                defaultValue={(c.options ?? []).map((o) => `${o.label}${o.emit ? ` | ${o.emit.cost} | ${o.emit.description}` : ""}`).join("\n")}
                placeholder={"None\nLight | 50 | Furniture moving (light)\nMedium | 100 | Furniture moving (medium)\nHeavy | 200 | Furniture moving (heavy)"}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm" />
            </div>
          </div>
        ) : null}
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : editing ? "Save question" : "Add question"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/settings/estimate-questions")}>Cancel</Button>
      </div>
    </form>
  );
}

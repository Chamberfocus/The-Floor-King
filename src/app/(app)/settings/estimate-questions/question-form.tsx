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
import type { EstimateQuestion, EstimateQuestionKind, QuestionPurpose } from "@/lib/types";
import { knowledgeQuestionByKey } from "@/lib/flooring-knowledge";

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
const PURPOSES: { value: QuestionPurpose; hint: string }[] = [
  { value: "MEASUREMENT", hint: "Size, counts, dimensions" },
  { value: "MATERIAL", hint: "What to buy" },
  { value: "LABOR", hint: "Install / demo / moving" },
  { value: "PREP", hint: "Substrate and leveling" },
  { value: "ACCESSORY", hint: "Trim, transitions, pad extras" },
  { value: "PRICE", hint: "Rate or allowance" },
  { value: "SCOPE", hint: "Job note, not a line" },
  { value: "SCHEDULING", hint: "Access, occupancy, timing" },
  { value: "PURCHASING", hint: "What warehouse / PO needs" },
  { value: "WAREHOUSE", hint: "Cuts, layout, roll goods" },
  { value: "INSTALLATION", hint: "How it goes down" },
  { value: "WARNING", hint: "Risk the salesperson must see" },
];

const label = "mb-1 block text-xs font-medium text-muted-foreground";
const field = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function QuestionForm({
  question,
  keyed = [],
}: {
  question?: EstimateQuestion;
  keyed?: { key: string; label: string }[];
}) {
  const router = useRouter();
  const editing = !!question;
  const action = editing ? updateEstimateQuestion : createEstimateQuestion;
  const [state, formAction, pending] = useActionState(action, initial);
  const [kind, setKind] = useState<EstimateQuestionKind>(question?.kind ?? "yesno");
  const c = question?.config ?? {};
  const e = c.emit ?? null;
  // Don't let a question reference itself in show_if.
  const refOptions = keyed.filter((k) => k.key !== question?.key);
  const compoundShowIf =
    c.show_if && ("all" in c.show_if || "any" in c.show_if) ? JSON.stringify(c.show_if, null, 2) : "";
  const simpleShowIf = c.show_if && "key" in c.show_if ? c.show_if : null;
  const defaultPurpose =
    c.purpose ?? (question?.key ? knowledgeQuestionByKey(question.key)?.purpose : undefined) ?? "";

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

      {/* Logic & scope — conditional visibility + per-room prep */}
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Logic &amp; scope
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Key (for conditional logic)</label>
            <Input name="key" defaultValue={question?.key ?? ""} placeholder="e.g. surface_type" />
            <p className="mt-1 text-xs text-muted-foreground">A short slug so other questions can branch off this one&apos;s answer.</p>
          </div>
          <div>
            <label className={label}>Why this question exists</label>
            <select name="purpose" defaultValue={defaultPurpose} className={field}>
              <option value="">Unset</option>
              {PURPOSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.value} — {p.hint}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              If a question has no downstream purpose, it probably does not belong. The flooring overlay uses this plus family/system gates.
            </p>
          </div>
          <div>
            <label className={label}>Show only if…</label>
            <div className="flex gap-2">
              <select name="show_if_key" defaultValue={simpleShowIf?.key ?? ""} className={field}>
                <option value="">Always show</option>
                {refOptions.map((k) => (
                  <option key={k.key} value={k.key}>{k.label} ({k.key})</option>
                ))}
              </select>
            </div>
            <Input name="show_if_in" defaultValue={(simpleShowIf?.in ?? []).join(", ")} placeholder="is: e.g. Laminate, Hardwood" className="mt-2" />
            <p className="mt-1 text-xs text-muted-foreground">Comma-separated answer value(s) that reveal this question. For AND/OR conditions, use the JSON field below — it wins on save.</p>
            <textarea
              name="show_if_json"
              rows={compoundShowIf ? 6 : 2}
              defaultValue={compoundShowIf}
              placeholder='Advanced (optional): {"all":[{"key":"install_method","in":["Floating / click"]},{"key":"attached_pad","in":["No"]}]}'
              className="mt-2 w-full rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="cfg_per_room" defaultChecked={c.per_room} className="size-4" />
            Per-room prep — answered once as the job default, overridable on rooms flagged as different
          </label>
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
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="cfg_allow_additional" defaultChecked={c.allow_additional} className="size-4" />
              Allow additional products for specific areas (e.g. a second/upgraded padding on the stairs) — one step, one or many
            </label>
            <p className="sm:col-span-2 text-xs text-muted-foreground">Renders a catalog picker for this category and adds a material line, with the correct unit (carpet &amp; pad in sq yd) and price. Install labor comes in automatically when the product carries a labor rate.</p>
          </div>
        ) : null}

        {kind === "yesno" || kind === "number" ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {kind === "yesno" ? (
              <div className="flex flex-wrap items-center gap-4 sm:col-span-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="cfg_default" defaultChecked={c.default} className="size-4" /> Pre-select &ldquo;Yes&rdquo;
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="cfg_note" defaultChecked={c.note} className="size-4" /> Record the answer as a job condition (work order)
                </label>
              </div>
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
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="cfg_multi" defaultChecked={c.multi} className="size-4" /> Allow multiple selections
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="cfg_note" defaultChecked={c.note} className="size-4" /> Record the answer as a job condition (work order)
              </label>
            </div>
            <div>
              <label className={label}>Options — one per line: &ldquo;Label | cost | line description&rdquo; (cost 0 = no line)</label>
              <textarea name="options" rows={4}
                defaultValue={(c.options ?? []).map((o) => `${o.label}${o.emit ? ` | ${o.emit.cost} | ${o.emit.description}` : ""}`).join("\n")}
                placeholder={"None\nLight | 50 | Furniture moving (light)\nMedium | 100 | Furniture moving (medium)\nHeavy | 200 | Furniture moving (heavy)"}
                className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm" />
            </div>
          </div>
        ) : null}

        {kind === "cuts" ? (
          <div>
            <label className={label}>Carpet install labor — our cost per sq&nbsp;yd</label>
            <Input
              name="cfg_install_yd"
              type="number"
              step="0.01"
              min="0"
              defaultValue={c.install_yd != null ? String(c.install_yd) : ""}
              placeholder="shop rate — do not invent"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Adds a carpet labor line at this rate × cut yardage when the product has no labor rate of its own. Leave blank rather than inventing $6.
            </p>
          </div>
        ) : null}

        {kind === "floor_map" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Carpet install — our cost per sq&nbsp;yd</label>
              <Input
                name="cfg_install_yd"
                type="number"
                step="0.01"
                min="0"
                defaultValue={c.install_yd != null ? String(c.install_yd) : ""}
                placeholder="shop rate — do not invent"
              />
            </div>
            <div>
              <label className={label}>Hard-surface install — our cost per sq&nbsp;ft</label>
              <Input
                name="cfg_install_ft"
                type="number"
                step="0.01"
                min="0"
                defaultValue={c.install_ft != null ? String(c.install_ft) : ""}
                placeholder="shop rate — do not invent"
              />
            </div>
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              Used to add install labor when a mapped product carries no labor rate of its own. Leave blank rather than inventing $6/yd or $2/ft.
            </p>
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

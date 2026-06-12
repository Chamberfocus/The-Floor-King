"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  WIZARD_INPUT_LABELS,
  WIZARD_KIND_LABELS,
  WIZARD_SECTIONS,
  type WizardQuestion,
  type WizardQuestionInput,
  type WizardQuestionKind,
} from "@/lib/types";
import {
  createQuestion,
  updateQuestion,
  type QuestionFormState,
} from "./actions";
import { SegmentedField } from "@/components/ui/segmented-field";

const initialState: QuestionFormState = { error: null };

export function QuestionForm({ question }: { question?: WizardQuestion }) {
  const isEdit = Boolean(question);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateQuestion : createQuestion,
    initialState,
  );

  useEffect(() => {
    if (state.ok) toast.success("Saved");
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      {isEdit ? <input type="hidden" name="id" value={question!.id} /> : null}

      <div className="space-y-2">
        <Label htmlFor="label">Question *</Label>
        <Input
          id="label"
          name="label"
          defaultValue={question?.label ?? ""}
          placeholder="e.g. Subfloor type & condition?"
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="help">Helper text (optional)</Label>
        <Input
          id="help"
          name="help"
          defaultValue={question?.help ?? ""}
          placeholder="A hint shown under the question"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="section">Section (journey step)</Label>
        <Input
          id="section"
          name="section"
          list="wizard-sections"
          defaultValue={question?.section ?? "Job details"}
          placeholder="e.g. Existing floor & subfloor"
        />
        <datalist id="wizard-sections">
          {WIZARD_SECTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Questions are grouped by section in the order shown in the wizard.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="options">Multiple-choice options (optional)</Label>
        <textarea
          id="options"
          name="options"
          rows={4}
          defaultValue={question?.options?.join("\n") ?? ""}
          placeholder={"One choice per line, e.g.\nCarpet\nHardwood\nLVP\nTile"}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          Add choices to turn this into a dropdown. Leave blank for a normal
          text / yes-no / number question.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Type</Label>
          <SegmentedField
            name="kind"
            defaultValue={question?.kind ?? "detail"}
            options={(Object.keys(WIZARD_KIND_LABELS) as WizardQuestionKind[]).map(
              (k) => ({ value: k, label: WIZARD_KIND_LABELS[k] }),
            )}
          />
        </div>
        <div className="space-y-2">
          <Label>Answer format</Label>
          <SegmentedField
            name="input"
            defaultValue={question?.input ?? "text"}
            options={(Object.keys(WIZARD_INPUT_LABELS) as WizardQuestionInput[]).map(
              (i) => ({ value: i, label: WIZARD_INPUT_LABELS[i] }),
            )}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="default_amount">
            Default price (add-on questions)
          </Label>
          <Input
            id="default_amount"
            name="default_amount"
            type="number"
            step="0.01"
            min="0"
            defaultValue={question?.default_amount ?? ""}
            placeholder="e.g. 250"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="position">Order</Label>
          <Input
            id="position"
            name="position"
            type="number"
            defaultValue={question?.position ?? ""}
            placeholder="Lower shows first"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="required"
            defaultChecked={question?.required ?? false}
            className="size-4 rounded border-input"
          />
          Mark as a must-ask (★) question
        </label>
        {isEdit ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={question?.active ?? true}
              className="size-4 rounded border-input"
            />
            Active (show in the wizard)
          </label>
        ) : null}
      </div>

      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : isEdit ? "Save changes" : "Add question"}
        </Button>
      </div>
    </form>
  );
}

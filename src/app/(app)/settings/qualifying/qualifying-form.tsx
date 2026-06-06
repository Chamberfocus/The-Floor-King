"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WIZARD_SECTIONS, type QualifyingQuestion } from "@/lib/types";
import {
  createQualifyingQuestion,
  updateQualifyingQuestion,
  type QQFormState,
} from "./actions";

const initialState: QQFormState = { error: null };
const fieldClass =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function QualifyingForm({ question }: { question?: QualifyingQuestion }) {
  const isEdit = Boolean(question);
  const [state, formAction, pending] = useActionState(
    isEdit ? updateQualifyingQuestion : createQualifyingQuestion,
    initialState,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success(isEdit ? "Saved" : "Question added");
      if (!isEdit) ref.current?.reset();
    }
    if (state.error) toast.error(state.error);
  }, [state, isEdit]);

  return (
    <form ref={ref} action={formAction} className="space-y-3">
      {isEdit ? <input type="hidden" name="id" value={question!.id} /> : null}
      <div className="space-y-1">
        <Label htmlFor="q-label">Question</Label>
        <Input
          id="q-label"
          name="label"
          defaultValue={question?.label ?? ""}
          placeholder="e.g. What's prompting the new floor?"
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="q-help">Helper text (optional)</Label>
        <Input
          id="q-help"
          name="help"
          defaultValue={question?.help ?? ""}
          placeholder="A hint shown under the question"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="q-section">Section</Label>
        <Input
          id="q-section"
          name="section"
          list="qq-sections"
          defaultValue={question?.section ?? "Qualifying"}
        />
        <datalist id="qq-sections">
          {WIZARD_SECTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1">
        <Label htmlFor="q-options">Multiple-choice options (optional)</Label>
        <textarea
          id="q-options"
          name="options"
          rows={3}
          defaultValue={question?.options?.join("\n") ?? ""}
          placeholder={"One per line — turns this into a dropdown"}
          className={fieldClass}
        />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="required"
            defaultChecked={question?.required ?? false}
            className="size-4 rounded border-input"
          />
          Must-ask (★)
        </label>
        {isEdit ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={question?.active ?? true}
              className="size-4 rounded border-input"
            />
            Active
          </label>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : isEdit ? "Save changes" : "Add question"}
      </Button>
    </form>
  );
}

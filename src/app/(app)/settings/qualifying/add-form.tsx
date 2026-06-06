"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createQualifyingQuestion, type QQFormState } from "./actions";

const initialState: QQFormState = { error: null };

export function AddQualifyingForm() {
  const [state, formAction, pending] = useActionState(
    createQualifyingQuestion,
    initialState,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success("Question added");
      ref.current?.reset();
    }
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <Input name="label" placeholder="Question (e.g. What is their budget?)" required />
      <Input name="help" placeholder="Helper text (optional)" />
      <Button type="submit" disabled={pending}>
        <Plus className="size-4" /> Add question
      </Button>
    </form>
  );
}

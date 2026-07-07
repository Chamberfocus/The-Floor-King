"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SegmentedField } from "@/components/ui/segmented-field";
import { wizardSectionRank, type QualifyingQuestion } from "@/lib/types";
import { qualifyAnswers } from "./qualify-actions";

const initial: { error: string | null; ok?: boolean } = { error: null };

/**
 * Optional qualifying questionnaire as a pop-up. Auto-opens right after a
 * customer is added ("Do you want to qualify?"); also reachable anytime from the
 * customer file. Saving records the answers + marks the lead qualified — nothing
 * else. Closing without saving keeps them un-qualified (do it later).
 */
export function QualifyDialog({
  customerId,
  questions,
  qualified,
  autoOpen = false,
}: {
  customerId: string;
  questions: QualifyingQuestion[];
  qualified: boolean;
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"ask" | "questions">("ask");
  const [state, action, pending] = useActionState(qualifyAnswers, initial);
  const askedRef = useRef(false);

  // Auto-open the prompt once, right after the customer was added.
  useEffect(() => {
    if (autoOpen && !qualified && !askedRef.current) {
      askedRef.current = true;
      setView("ask");
      setOpen(true);
    }
  }, [autoOpen, qualified]);

  useEffect(() => {
    if (state.ok) {
      toast.success("Customer qualified");
      setOpen(false);
      setView("ask");
      router.refresh();
    }
  }, [state, router]);

  const sections = Array.from(new Set(questions.map((q) => q.section))).sort(
    (a, b) => wizardSectionRank(a) - wizardSectionRank(b) || a.localeCompare(b),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setView("ask");
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ClipboardCheck className="size-4" />{" "}
        {qualified ? "Re-qualify" : "Qualify customer"}
      </DialogTrigger>
      <DialogContent>
        {view === "ask" ? (
          <>
            <DialogHeader>
              <DialogTitle>Qualify this customer?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Run the intake questions now, or do it later from the customer file.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Not now
              </Button>
              <Button
                onClick={() => setView("questions")}
                disabled={questions.length === 0}
              >
                Yes, qualify
              </Button>
            </div>
            {questions.length === 0 ? (
              <p className="mt-2 text-xs text-amber-600">
                No qualifying questions are set up yet (Settings → Qualifying).
              </p>
            ) : null}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Qualify customer</DialogTitle>
            </DialogHeader>
            <form action={action} className="space-y-4">
              <input type="hidden" name="customer_id" value={customerId} />
              <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                {sections.map((section) => (
                  <div key={section} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section}
                    </div>
                    {questions
                      .filter((q) => q.section === section)
                      .sort((a, b) => a.position - b.position)
                      .map((q) => (
                        <div key={q.id} className="space-y-1">
                          <label className="text-sm font-medium">
                            {q.required ? <span className="text-amber-600">★ </span> : null}
                            {q.label}
                          </label>
                          {q.help ? (
                            <p className="text-xs text-muted-foreground">{q.help}</p>
                          ) : null}
                          {q.options?.length ? (
                            <SegmentedField
                              name={`q_${q.id}`}
                              defaultValue=""
                              options={q.options.map((o) => ({ value: o, label: o }))}
                            />
                          ) : (
                            <textarea
                              name={`q_${q.id}`}
                              rows={2}
                              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          )}
                        </div>
                      ))}
                  </div>
                ))}
              </div>
              {state.error ? (
                <p className="text-sm text-destructive" role="alert">
                  {state.error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save qualification"}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

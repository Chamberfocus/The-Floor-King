import type { Metadata } from "next";
import Link from "next/link";
import { Plus, ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { listWizardQuestions } from "@/lib/data/wizard";
import { WIZARD_INPUT_LABELS, wizardSectionRank } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { moveQuestion, deleteQuestion } from "./actions";

export const metadata: Metadata = { title: "Wizard Setup" };

export default async function WizardSetupPage() {
  const questions = await listWizardQuestions();

  // Group into journey sections (canonical order; unknown sections last).
  const sections = Array.from(new Set(questions.map((q) => q.section))).sort(
    (a, b) => wizardSectionRank(a) - wizardSectionRank(b) || a.localeCompare(b),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Estimate Wizard"
        description="The guided questionnaire your salespeople walk through. Reorder within a section with the arrows, edit any question, or change its Section to move it in the journey. Detail questions build the job description; add-on questions add a priced line."
      >
        <Link
          href="/settings/wizard/new"
          className={buttonVariants({ size: "lg" })}
        >
          <Plus className="size-4" /> Add question
        </Link>
      </PageHeader>

      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No questions yet. Add the prompts your wizard should ask.
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const items = questions
              .filter((q) => q.section === section)
              .sort((a, b) => a.position - b.position);
            return (
              <section key={section}>
                <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">
                  {section}
                </h2>
                <div className="space-y-2">
                  {items.map((q, i) => (
                    <Card key={q.id} className={q.active ? "" : "opacity-60"}>
                      <CardContent className="flex items-center gap-3 py-3">
                        <div className="flex flex-col">
                          <form action={moveQuestion}>
                            <input type="hidden" name="id" value={q.id} />
                            <input type="hidden" name="dir" value="up" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Move up"
                              disabled={i === 0}
                            >
                              <ChevronUp className="size-3.5" />
                            </Button>
                          </form>
                          <form action={moveQuestion}>
                            <input type="hidden" name="id" value={q.id} />
                            <input type="hidden" name="dir" value="down" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon-xs"
                              aria-label="Move down"
                              disabled={i === items.length - 1}
                            >
                              <ChevronDown className="size-3.5" />
                            </Button>
                          </form>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {q.required ? (
                              <span className="text-amber-600" title="Must-ask">
                                ★{" "}
                              </span>
                            ) : null}
                            {q.label}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span
                              className={
                                q.kind === "addon"
                                  ? "rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300"
                                  : "rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                              }
                            >
                              {q.kind === "addon" ? "Add-on line" : "Detail"}
                            </span>
                            <span>
                              {q.options?.length
                                ? "Dropdown"
                                : WIZARD_INPUT_LABELS[q.input]}
                            </span>
                            {q.kind === "addon" && q.default_amount != null ? (
                              <span>
                                · default {formatMoney(q.default_amount)}
                              </span>
                            ) : null}
                            {!q.active ? <span>· inactive</span> : null}
                          </div>
                        </div>

                        <Link
                          href={`/settings/wizard/${q.id}`}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Edit"
                        >
                          <Pencil className="size-4" />
                        </Link>
                        <form action={deleteQuestion}>
                          <input type="hidden" name="id" value={q.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Delete"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronUp, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listEstimateQuestions } from "@/lib/data/estimate-questions";
import { QuestionForm } from "./question-form";
import { deleteEstimateQuestion, moveEstimateQuestion } from "./actions";

export const metadata: Metadata = { title: "Estimate questionnaire" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  areas: "Areas / measurements",
  product: "Catalog product",
  yesno: "Yes / No",
  number: "Number",
  choice: "Choice",
  text: "Text note",
};

export default async function EstimateQuestionsSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const questions = await listEstimateQuestions();
  const keyed = questions
    .filter((q) => q.key)
    .map((q) => ({ key: q.key as string, label: q.label }));
  const sections = Array.from(new Set(questions.map((q) => q.section))).sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Estimate questionnaire"
        description="The questions your guided estimate builder asks. Fully editable — add, edit, delete, or reorder. Each question maps its answer to the estimate (a material, labor, or note). Changes appear in the builder immediately."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a question</CardTitle>
        </CardHeader>
        <CardContent>
          <QuestionForm keyed={keyed} />
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No questions yet — add one above (or run the estimate_questions migration to seed the carpet questionnaire).
        </div>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => {
            const items = questions
              .filter((q) => q.section === section)
              .sort((a, b) => a.position - b.position);
            return (
              <section key={section}>
                <h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">{section}</h2>
                <div className="space-y-2">
                  {items.map((q, i) => (
                    <div key={q.id} className={`flex items-center gap-2 rounded-md border p-2 ${q.active ? "" : "opacity-60"}`}>
                      <div className="flex flex-col">
                        <form action={moveEstimateQuestion}>
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="dir" value="up" />
                          <Button type="submit" variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0}>
                            <ChevronUp className="size-3.5" />
                          </Button>
                        </form>
                        <form action={moveEstimateQuestion}>
                          <input type="hidden" name="id" value={q.id} />
                          <input type="hidden" name="dir" value="down" />
                          <Button type="submit" variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === items.length - 1}>
                            <ChevronDown className="size-3.5" />
                          </Button>
                        </form>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {q.required ? <span className="text-amber-600">★ </span> : null}
                          {q.label}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{KIND_LABEL[q.kind] ?? q.kind}</span>
                          {q.config.emit?.description ? <span>· {q.config.emit.role} “{q.config.emit.description}”</span> : null}
                          {q.config.category ? <span>· {q.config.category}</span> : null}
                          {!q.active ? <span>· inactive</span> : null}
                        </div>
                      </div>
                      <Link href={`/settings/estimate-questions/${q.id}`} className="text-muted-foreground hover:text-foreground" aria-label="Edit">
                        <Pencil className="size-4" />
                      </Link>
                      <form action={deleteEstimateQuestion}>
                        <input type="hidden" name="id" value={q.id} />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Delete">
                          <Trash2 className="size-4" />
                        </Button>
                      </form>
                    </div>
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

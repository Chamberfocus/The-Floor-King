import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronUp, ChevronDown, Pencil, Trash2, ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { wizardSectionRank } from "@/lib/types";
import { QualifyingForm } from "./qualifying-form";
import { deleteQualifyingQuestion, moveQualifyingQuestion } from "./actions";

export const metadata: Metadata = { title: "Qualifying questions" };

export default async function QualifyingSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const questions = await listQualifyingQuestions();
  const sections = Array.from(new Set(questions.map((q) => q.section))).sort(
    (a, b) => wizardSectionRank(a) - wizardSectionRank(b) || a.localeCompare(b),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Qualifying questionnaire"
        description="The intake journey your team walks through with a new lead. Grouped into sections; reorder within a section, edit any question, or change its Section to move it."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a question</CardTitle>
        </CardHeader>
        <CardContent>
          <QualifyingForm />
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <EmptyState icon={ListChecks} title="No questions yet" />
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
                    <div
                      key={q.id}
                      className={`flex items-center gap-2 rounded-md border p-2 ${
                        q.active ? "" : "opacity-60"
                      }`}
                    >
                      <div className="flex flex-col">
                        <form action={moveQualifyingQuestion}>
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
                        <form action={moveQualifyingQuestion}>
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
                            <span className="text-amber-600">★ </span>
                          ) : null}
                          {q.label}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {q.options?.length ? <span>Dropdown</span> : <span>Text</span>}
                          {!q.active ? <span>· inactive</span> : null}
                        </div>
                      </div>
                      <Link
                        href={`/settings/qualifying/${q.id}`}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Edit"
                      >
                        <Pencil className="size-4" />
                      </Link>
                      <form action={deleteQualifyingQuestion}>
                        <input type="hidden" name="id" value={q.id} />
                        <ConfirmButton
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete"
                          title="Delete this qualifying question?"
                          description="Removes the question from the lead qualifying flow. This can't be undone."
                          confirmLabel="Delete"
                          destructive
                        >
                          <Trash2 className="size-4" />
                        </ConfirmButton>
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

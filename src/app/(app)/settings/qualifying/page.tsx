import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { AddQualifyingForm } from "./add-form";
import { deleteQualifyingQuestion, moveQualifyingQuestion } from "./actions";

export const metadata: Metadata = { title: "Qualifying questions" };

export default async function QualifyingSettingsPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const questions = await listQualifyingQuestions();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Qualifying questions"
        description="The questions your team runs through when qualifying a new lead."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a question</CardTitle>
        </CardHeader>
        <CardContent>
          <AddQualifyingForm />
        </CardContent>
      </Card>

      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No questions yet.
        </div>
      ) : (
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div
              key={q.id}
              className="flex items-center gap-2 rounded-md border p-2"
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
                    disabled={i === questions.length - 1}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                </form>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{q.label}</div>
                {q.help ? (
                  <div className="text-xs text-muted-foreground">{q.help}</div>
                ) : null}
              </div>
              <form action={deleteQualifyingQuestion}>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

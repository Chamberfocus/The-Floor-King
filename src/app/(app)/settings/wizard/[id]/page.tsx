import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getWizardQuestion } from "@/lib/data/wizard";
import { QuestionForm } from "../question-form";

export const metadata: Metadata = { title: "Edit question" };

export default async function EditQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const question = await getWizardQuestion(id);
  if (!question) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings/wizard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to wizard setup
      </Link>
      <PageHeader title="Edit question" />
      <Card>
        <CardContent className="pt-6">
          <QuestionForm question={question} />
        </CardContent>
      </Card>
    </div>
  );
}

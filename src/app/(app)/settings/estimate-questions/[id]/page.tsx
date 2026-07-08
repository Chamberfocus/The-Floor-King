import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getEstimateQuestion } from "@/lib/data/estimate-questions";
import { QuestionForm } from "../question-form";

export const metadata: Metadata = { title: "Edit question" };
export const dynamic = "force-dynamic";

export default async function EditEstimateQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const { id } = await params;
  const question = await getEstimateQuestion(id);
  if (!question) redirect("/settings/estimate-questions");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings/estimate-questions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to questions
      </Link>
      <PageHeader title="Edit question" description="Change the question, its answer type, or how the answer maps into the estimate." />
      <Card>
        <CardContent className="pt-6">
          <QuestionForm question={question} />
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { getQualifyingQuestion } from "@/lib/data/qualifying";
import { QualifyingForm } from "../qualifying-form";

export const metadata: Metadata = { title: "Edit qualifying question" };

export default async function EditQualifyingQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  const { id } = await params;
  const question = await getQualifyingQuestion(id);
  if (!question) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings/qualifying"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to qualifying questions
      </Link>
      <PageHeader title="Edit question" />
      <Card>
        <CardContent className="pt-6">
          <QualifyingForm question={question} />
        </CardContent>
      </Card>
    </div>
  );
}

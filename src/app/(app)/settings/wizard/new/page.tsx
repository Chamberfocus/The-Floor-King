import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { QuestionForm } from "../question-form";

export const metadata: Metadata = { title: "Add question" };

export default function NewQuestionPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/settings/wizard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to wizard setup
      </Link>
      <PageHeader title="Add question" />
      <Card>
        <CardContent className="pt-6">
          <QuestionForm />
        </CardContent>
      </Card>
    </div>
  );
}

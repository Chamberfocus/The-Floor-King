import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getCustomer, listActivities } from "@/lib/data/customers";
import { listQualifyingQuestions } from "@/lib/data/qualifying";
import { formatDate } from "@/lib/format";
import { QualifyPanel } from "../qualify-panel";

export const metadata: Metadata = { title: "Qualification" };

export default async function QualifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  const questions = await listQualifyingQuestions({ activeOnly: true });
  const activities = await listActivities(id);
  const saved = activities
    .filter((a) => a.type === "note" && a.body?.startsWith("Lead qualified"))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/customers/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to {customer.full_name}
      </Link>
      <PageHeader
        title="Qualification"
        description="The intake questionnaire and the answers on file for this customer."
      />

      {saved ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">
              Saved answers{" "}
              <span className="text-xs font-normal text-muted-foreground">
                · {formatDate(saved.created_at)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
              {saved.body}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <QualifyPanel
        customerId={customer.id}
        questions={questions}
        qualified={customer.qualified}
      />
    </div>
  );
}

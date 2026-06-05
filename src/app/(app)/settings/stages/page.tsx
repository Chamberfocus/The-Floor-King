import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listWorkflowStages, listHandoffMembers } from "@/lib/data/workflow";
import { AddStageForm } from "./add-stage-form";
import { StageRow } from "./stage-row";

export const metadata: Metadata = { title: "Workflow stages" };

export default async function StagesPage() {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");

  const [stages, members] = await Promise.all([
    listWorkflowStages(),
    listHandoffMembers(),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Workflow stages"
        description="The steps every client moves through, and the default person who owns each step."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Add a stage</CardTitle>
        </CardHeader>
        <CardContent>
          <AddStageForm members={members} />
        </CardContent>
      </Card>

      {stages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No stages yet. Add your first one above.
        </div>
      ) : (
        <div className="space-y-2">
          {stages.map((s, i) => (
            <StageRow
              key={s.id}
              stage={s}
              members={members}
              isFirst={i === 0}
              isLast={i === stages.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

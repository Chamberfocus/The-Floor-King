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
import { StageList } from "./stage-list";
import { ResyncStagesButton } from "./resync-button";

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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm text-muted-foreground">
          Changed your stages? Re-align every existing customer to them — places
          anyone missing a stage and refreshes the dashboard. Doesn&apos;t move
          anyone&apos;s real progress.
        </p>
        <ResyncStagesButton />
      </div>

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
        <StageList stages={stages} members={members} />
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { LEAD_STAGE_BADGE, LEAD_STAGE_LABELS, type LeadStage } from "@/lib/types";

export function StageBadge({
  stage,
  className,
}: {
  stage: LeadStage;
  className?: string;
}) {
  return (
    <StatusBadge
      label={LEAD_STAGE_LABELS[stage]}
      className={cn(LEAD_STAGE_BADGE[stage], className)}
    />
  );
}

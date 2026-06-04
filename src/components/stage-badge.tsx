import { cn } from "@/lib/utils";
import { LEAD_STAGE_BADGE, LEAD_STAGE_LABELS, type LeadStage } from "@/lib/types";

export function StageBadge({
  stage,
  className,
}: {
  stage: LeadStage;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        LEAD_STAGE_BADGE[stage],
        className,
      )}
    >
      {LEAD_STAGE_LABELS[stage]}
    </span>
  );
}

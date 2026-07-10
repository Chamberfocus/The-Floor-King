import { resolveFlowStep, spinePosition, STEP_TITLES, type StageLike } from "@/lib/job-flow";

/**
 * The shared "where in the flow" chip. Reads the customer's real workflow stage
 * through the ONE shared resolver, so the job / installer / warehouse pages show
 * the exact same position as the customer dashboard's guided flow.
 */
export function FlowPositionBadge({
  stage,
  stages,
  className,
}: {
  stage: StageLike | null;
  stages: StageLike[];
  className?: string;
}) {
  if (!stage) return null;
  const step = resolveFlowStep(stage, stages);
  const { index, total } = spinePosition(stage, stages);
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary " +
        (className ?? "")
      }
    >
      <span className="tabular-nums">
        {index >= 0 ? `Stage ${index + 1}/${total}` : stage.name}
      </span>
      <span className="opacity-70">· {STEP_TITLES[step]}</span>
    </span>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { customerLaneSteps } from "@/lib/portal-dashboard";
import type { PortalProject } from "@/lib/data/portal-projects";
import { cn } from "@/lib/utils";

export function PortalProjectCard({
  project,
  children,
}: {
  project: PortalProject;
  children?: ReactNode;
}) {
  const steps = customerLaneSteps();
  const current = project.stage.lane;
  const currentIndex = current ? steps.findIndex((step) => step.key === current) : -1;
  const showTrail = !project.stage.closed && currentIndex >= 0;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-sm text-muted-foreground">
        {project.site ? project.site : project.kind === "job" ? "Installation" : "Where things stand"}
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{project.title}</h2>
      <p className="mt-3 text-lg font-semibold text-primary">{project.stage.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">{project.stage.detail}</p>

      {showTrail ? (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span>{steps[currentIndex].label}</span>
            <span>
              {currentIndex + 1} of {steps.length}
            </span>
          </div>
          <ol className="flex gap-1" aria-label="Project progress">
            {steps.map((step, index) => (
              <li
                key={step.key}
                title={step.label}
                aria-current={index === currentIndex ? "step" : undefined}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  index <= currentIndex ? "bg-primary" : "bg-muted",
                )}
              >
                <span className="sr-only">{step.label}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {children}

      <p className="mt-4 text-sm">
        {project.salespersonName ? (
          <>
            Your salesperson is{" "}
            <Link href="/portal/messages" className="font-medium text-primary hover:underline">
              {project.salespersonName}
            </Link>
            .
          </>
        ) : (
          <Link href="/portal/messages" className="font-medium text-primary hover:underline">
            Message the store
          </Link>
        )}
      </p>
    </section>
  );
}

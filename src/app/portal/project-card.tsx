import Link from "next/link";
import { customerLaneSteps } from "@/lib/portal-dashboard";
import type { PortalProject } from "@/lib/data/portal-projects";
import { cn } from "@/lib/utils";

export function PortalProjectCard({ project }: { project: PortalProject }) {
  const steps = customerLaneSteps();
  const current = project.stage.lane;
  const currentIndex = current ? steps.findIndex((step) => step.key === current) : -1;

  return (
    <section className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-sm text-muted-foreground">
        {project.site ? project.site : project.kind === "job" ? "Installation" : "Where things stand"}
      </div>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{project.title}</h2>
      <p className="mt-3 text-lg font-semibold text-primary">{project.stage.name}</p>
      <p className="mt-1 text-sm text-muted-foreground">{project.stage.detail}</p>
      {project.salespersonName ? (
        <p className="mt-3 text-sm">
          Your salesperson is <span className="font-medium">{project.salespersonName}</span>.
        </p>
      ) : null}

      {project.stage.closed || currentIndex < 0 ? null : (
        <ol className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {steps.map((step, index) => {
            const state =
              index < currentIndex ? "done" : index === currentIndex ? "now" : "later";
            return (
              <li
                key={step.key}
                aria-current={state === "now" ? "step" : undefined}
                className={cn(
                  "rounded-md border px-2 py-2 text-center text-xs font-medium",
                  state === "now" && "border-primary bg-primary text-primary-foreground",
                  state === "done" && "border-primary/30 bg-primary/10 text-foreground",
                  state === "later" && "text-muted-foreground",
                )}
              >
                {step.label}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/portal/estimates" className="font-medium text-primary hover:underline">
          Estimate
        </Link>
        <Link href="/portal/invoices" className="font-medium text-primary hover:underline">
          Invoice
        </Link>
        <Link href="/portal/messages" className="font-medium text-primary hover:underline">
          Message {project.salespersonName ? project.salespersonName : "the store"}
        </Link>
      </div>
    </section>
  );
}

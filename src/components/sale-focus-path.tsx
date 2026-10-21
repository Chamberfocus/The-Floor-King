import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import type { SaleFocus } from "@/lib/sale-focus";
import { cn } from "@/lib/utils";

export function SaleFocusPath({
  focus,
  customerName,
  showSwitch = false,
  embedded = false,
}: {
  focus: SaleFocus;
  customerName: string;
  showSwitch?: boolean;
  /** Sits inside the customer header instead of its own card. */
  embedded?: boolean;
}) {
  return (
    <section
      aria-label={`Sale for ${customerName}`}
      className={cn(embedded ? "mt-3 border-t pt-3" : "mb-3 rounded-lg border bg-card p-3 sm:p-4")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">This sale</h2>
        {showSwitch ? (
          <Link href="/home#other-sales" className="text-sm font-medium text-primary hover:underline">
            Switch customer
          </Link>
        ) : null}
      </div>
      <ol className="mt-3 space-y-2" aria-label="Sale steps">
        {focus.steps.map((step, index) => (
          <li key={step.step} className="flex items-center gap-2 text-sm" aria-current={step.state === "current" ? "step" : undefined}>
            <span
              aria-hidden
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                step.state === "done" && "bg-emerald-600 text-white",
                step.state === "current" && "bg-primary text-primary-foreground",
                step.state === "later" && "bg-muted text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                "min-w-0",
                step.state === "current" && "font-semibold",
                step.state === "later" && "text-muted-foreground",
              )}
            >
              {step.title}
              {step.state === "done" ? <span className="sr-only">, done</span> : null}
            </span>
            {step.state === "current" ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                Now
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {focus.move ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{focus.move.detail}</p>
          <Link
            href={focus.move.href}
            className={cn(buttonVariants({ size: "lg" }), "min-h-11 shrink-0")}
          >
            {focus.move.label}
          </Link>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          The deposit is in. This sale is with the shop for materials and the install.
        </p>
      )}
    </section>
  );
}

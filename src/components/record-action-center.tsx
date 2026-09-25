import Link from "next/link";
import { AlertTriangle, Check, Circle } from "lucide-react";
import type { RecordActionCenterModel } from "@/lib/record-action-center";
import { presentRecordAction, type ActionChip } from "@/lib/present-record-action";

function Chip({ chip }: { chip: ActionChip }) {
  const Icon = chip.tone === "done" ? Check : chip.tone === "warn" ? AlertTriangle : Circle;
  return (
    <li className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{chip.label}</span>
    </li>
  );
}

export function RecordActionCenter({ model }: { model: RecordActionCenterModel }) {
  const view = presentRecordAction(model);
  const quietOnly = !!view.quiet && !view.headline && !view.warning && view.chips.length === 0 && !view.note;
  if (quietOnly && view.history.length === 0) {
    return (
      <p className="mb-3 rounded-lg border bg-card px-3 py-2.5 text-sm" role="status">
        {view.quiet}
      </p>
    );
  }
  return (
    <section aria-labelledby="record-action-heading" className="mb-3 rounded-lg border bg-card px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 id="record-action-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What to do
          </h2>
          {view.headline ? (
            <p className="mt-1 text-lg font-semibold leading-tight">{view.headline}</p>
          ) : null}
          {view.warning ? (
            <p className="mt-1 flex items-start gap-1.5 text-sm">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{view.warning}</span>
            </p>
          ) : null}
          {view.chips.length ? (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {view.chips.map((chip) => (
                <Chip key={chip.label} chip={chip} />
              ))}
            </ul>
          ) : null}
          {view.note ? <p className="mt-2 text-sm text-muted-foreground">{view.note}</p> : null}
          {view.quiet && !view.headline ? <p className="mt-1 text-sm">{view.quiet}</p> : null}
        </div>
        {model.primary || model.secondary.length ? (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col lg:items-stretch">
            {model.primary ? (
              <Link
                href={model.primary.href}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {model.primary.label}
              </Link>
            ) : null}
            {model.secondary.map((link) => (
              <Link
                key={`${link.label}-${link.href}`}
                href={link.href}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      {view.history.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Recent activity
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
            {view.history.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

import Link from "next/link";
import type { RecordActionCenterModel } from "@/lib/record-action-center";

export function RecordActionCenter({ model }: { model: RecordActionCenterModel }) {
  const quietOnly = !!model.quiet && !model.primary && !model.blocker && !model.attention && model.secondary.length === 0;
  if (quietOnly && model.situation.length === 0 && model.history.length === 0) {
    return (
      <p className="mb-4 rounded-lg border bg-card px-4 py-3 text-sm" role="status">
        {model.quiet}
      </p>
    );
  }
  return (
    <section aria-labelledby="record-action-heading" className="mb-4 rounded-lg border bg-card p-4">
      <h2 id="record-action-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        What to do
      </h2>
      {model.situation.length ? (
        <ul className="mt-2 flex flex-col gap-1">
          {model.situation.map((line) => (
            <li key={line} className="text-base font-semibold">
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {model.blocker ? (
        <p className="mt-3 text-sm">
          <span className="font-semibold">Blocked. </span>
          {model.blocker}
        </p>
      ) : null}
      {model.attention && !model.blocker ? (
        <p className="mt-3 text-sm">
          <span className="font-semibold">Needs attention. </span>
          {model.attention}
        </p>
      ) : null}
      {model.also ? <p className="mt-2 text-sm text-muted-foreground">{model.also}</p> : null}
      {model.quiet && !model.primary ? <p className="mt-3 text-sm">{model.quiet}</p> : null}
      {model.history.length ? (
        <ul className="mt-3 flex flex-col gap-0.5 text-sm text-muted-foreground">
          {model.history.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {model.primary || model.secondary.length ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border bg-background px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

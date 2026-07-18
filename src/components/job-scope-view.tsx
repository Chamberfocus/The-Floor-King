import { lineSpec, PAD_ROLL_SQYD, type JobScope } from "@/lib/job-scope";
import { lineTotal } from "@/lib/estimate-calc";
import { formatMoney } from "@/lib/format";
import type { EstimateLineItem } from "@/lib/types";

function Line({ l, showPrices }: { l: EstimateLineItem; showPrices: boolean }) {
  const spec = lineSpec(l);
  const tags = [l.manufacturer, l.style, l.color, l.item_no ? `#${l.item_no}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="font-medium">
          {l.description || "Line item"}
          {tags ? <span className="ml-1 text-xs font-normal text-muted-foreground">{tags}</span> : null}
          {l.from_stock ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              From stock
            </span>
          ) : null}
        </div>
        {(l.note ?? "").trim() ? (
          <div className="mt-0.5 text-sm text-muted-foreground">{l.note}</div>
        ) : null}
        {spec.qty || spec.cut || spec.rolls ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {spec.qty ? <span className="font-medium text-foreground">{spec.qty}</span> : null}
            {spec.cut ? (
              <span className="rounded bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
                ✂ Cut {spec.cut}
              </span>
            ) : null}
            {spec.rolls ? (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                {spec.rolls} roll{spec.rolls > 1 ? "s" : ""} @ {PAD_ROLL_SQYD} sq yd
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {showPrices ? (
        <div className="shrink-0 text-muted-foreground">{formatMoney(lineTotal(l))}</div>
      ) : null}
    </div>
  );
}

/**
 * The INSTALLATION work order on screen — scope grouped by room (product going
 * in + per-room prep + labor), then whole-job labor and job-wide conditions.
 * Shared by the job page and the installer's My Work portal so the crew always
 * sees the installation work order (never the warehouse staging sheet).
 */
export function JobScopeView({
  scope,
  showPrices = false,
}: {
  scope: JobScope;
  showPrices?: boolean;
}) {
  const empty =
    !scope.rooms.length && !scope.wholeJob.products.length && !scope.wholeJob.labor.length;
  if (empty) {
    return (
      <p className="text-sm text-muted-foreground">
        No scope attached to this job yet.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {scope.conditions.length ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Conditions &amp; prep — all areas
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-200">
            {scope.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {scope.rooms.map((room) => (
        <div key={room.name} className="rounded-lg border p-3">
          <div className="flex items-baseline justify-between gap-2 border-b pb-1">
            <div className="font-semibold">{room.name}</div>
            {room.sqft ? (
              <div className="text-xs tabular-nums text-muted-foreground">
                {Math.round(room.sqft)} sq ft
              </div>
            ) : null}
          </div>
          {room.prep.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {room.prep.map((p, i) => (
                <span
                  key={i}
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                >
                  {p}
                </span>
              ))}
            </div>
          ) : null}
          {room.products.length ? (
            <div className="mt-2">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Product going in
              </div>
              <div className="divide-y text-sm">
                {room.products.map((l) => (
                  <Line key={l.id} l={l} showPrices={showPrices} />
                ))}
              </div>
            </div>
          ) : null}
          {room.labor.length ? (
            <div className="mt-2">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Prep &amp; labor
              </div>
              <div className="divide-y text-sm">
                {room.labor.map((l) => (
                  <Line key={l.id} l={l} showPrices={showPrices} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {scope.wholeJob.products.length || scope.wholeJob.labor.length ? (
        <div className="rounded-lg border p-3">
          <div className="border-b pb-1 font-semibold">Whole job</div>
          {scope.wholeJob.products.length ? (
            <div className="mt-2">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Materials
              </div>
              <div className="divide-y text-sm">
                {scope.wholeJob.products.map((l) => (
                  <Line key={l.id} l={l} showPrices={showPrices} />
                ))}
              </div>
            </div>
          ) : null}
          {scope.wholeJob.labor.length ? (
            <div className="mt-2">
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Labor &amp; prep
              </div>
              <div className="divide-y text-sm">
                {scope.wholeJob.labor.map((l) => (
                  <Line key={l.id} l={l} showPrices={showPrices} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {scope.freeText ? (
        <div className="rounded-md bg-muted p-3 text-sm">
          <div className="mb-1 font-medium">Special instructions</div>
          <p className="whitespace-pre-wrap text-muted-foreground">{scope.freeText}</p>
        </div>
      ) : null}
    </div>
  );
}

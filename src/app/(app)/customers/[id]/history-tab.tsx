import Link from "next/link";
import {
  FileText,
  Wrench,
  Receipt,
  DollarSign,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CustomerHistory, HistoryEvent } from "@/lib/data/customer-history";

const ICON: Record<HistoryEvent["kind"], LucideIcon> = {
  estimate: FileText,
  job: Wrench,
  invoice: Receipt,
  payment: DollarSign,
};

const TONE: Record<HistoryEvent["kind"], string> = {
  estimate: "text-blue-600 dark:text-blue-400",
  job: "text-violet-600 dark:text-violet-400",
  invoice: "text-amber-600 dark:text-amber-400",
  payment: "text-emerald-600 dark:text-emerald-400",
};

function Row({ e, showProperty }: { e: HistoryEvent; showProperty: boolean }) {
  const Icon = ICON[e.kind];
  return (
    <Link
      href={e.href}
      className="flex items-start gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[e.kind])} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0 break-words text-sm font-medium">{e.title}</span>
          {e.amount != null ? (
            <span className="shrink-0 text-sm tabular-nums">
              {formatMoney(e.amount)}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{e.at ? formatDate(e.at) : "—"}</span>
          {e.status ? <span>· {e.status}</span> : null}
          {e.detail ? <span>· {e.detail}</span> : null}
          {showProperty && e.propertyLabel ? (
            <span className="inline-flex items-center gap-1">
              · <MapPin className="size-3" /> {e.propertyLabel}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/**
 * Everything this customer has ever done with us, in one place.
 *
 * Separate estimate / job / invoice tabs answer "what estimates are there".
 * They don't answer "what have we done for these people, where, and did we get
 * paid" — which is the only question that matters on a commercial account with
 * several properties, and it took four tabs and mental arithmetic.
 */
export function HistoryTab({ history }: { history: CustomerHistory }) {
  const { events, properties, totals } = history;
  if (!events.length) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nothing yet. Estimates, jobs, invoices and payments all appear here as
        they happen.
      </p>
    );
  }

  // Only worth splitting by property when there is more than one to split by.
  const named = properties.filter((p) => p.id);
  const byProperty = named.length > 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
          {[
            ["Quoted", totals.quoted],
            ["Sold", totals.won],
            ["Billed", totals.billed],
            ["Collected", totals.paid],
          ].map(([label, v]) => (
            <div key={label as string}>
              <div className="text-xs text-muted-foreground">{label as string}</div>
              <div className="text-lg font-semibold tabular-nums">
                {formatMoney(v as number)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-muted-foreground">
        {totals.winRate != null ? (
          <span>
            Won <span className="font-semibold text-foreground">{totals.winRate}%</span>{" "}
            of decided quotes
          </span>
        ) : (
          <span>No quote decided yet</span>
        )}
        {totals.outstanding > 0.005 ? (
          <span>
            Outstanding{" "}
            <span className="font-semibold text-destructive">
              {formatMoney(totals.outstanding)}
            </span>
          </span>
        ) : null}
        {totals.firstSeen ? (
          <span>Customer since {formatDate(totals.firstSeen)}</span>
        ) : null}
        {totals.lastSeen ? <span>Last activity {formatDate(totals.lastSeen)}</span> : null}
      </div>

      {byProperty ? (
        properties.map((p) => (
          <div key={p.id ?? "none"} className="rounded-lg border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="break-words">{p.label}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                quoted {formatMoney(p.quoted)} · billed {formatMoney(p.billed)} ·
                collected {formatMoney(p.paid)}
              </span>
            </div>
            {p.events.map((e) => (
              <Row key={`${e.kind}-${e.id}`} e={e} showProperty={false} />
            ))}
          </div>
        ))
      ) : (
        <div className="rounded-lg border">
          {events.map((e) => (
            <Row key={`${e.kind}-${e.id}`} e={e} showProperty />
          ))}
        </div>
      )}
    </div>
  );
}

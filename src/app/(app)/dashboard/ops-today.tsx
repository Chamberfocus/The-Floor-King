import Link from "next/link";
import { opsQueueLabel } from "@/lib/ops-followup";
import type { OpsQueue } from "@/lib/data/ops-queues";

export function OpsToday({ queues }: { queues: OpsQueue[] }) {
  const active = queues.filter((q) => q.items.length > 0);
  if (!active.length) {
    return (
      <div className="mb-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Nothing operational is waiting right now. Follow-ups, deposits, orders,
        installs, collections, and callbacks will show here.
      </div>
    );
  }
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {active.map((q) => (
        <section key={q.id} className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">{opsQueueLabel(q.id)}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {q.items.length}
            </span>
          </div>
          <ul className="space-y-1.5">
            {q.items.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="block text-sm hover:underline">
                  <span className="font-medium">{item.title}</span>
                  {item.hint ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

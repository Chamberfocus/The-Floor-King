"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageCheck } from "lucide-react";
import { getImportJobsState } from "@/app/(app)/catalog/import-actions";
import type { ImportJob } from "@/lib/data/import-jobs";

/**
 * Live, app-wide indicator for background imports. Polls every few seconds so
 * the user sees progress from any page and gets a toast when one finishes.
 */
export function ImportJobsBanner() {
  const router = useRouter();
  const [active, setActive] = useState<ImportJob[]>([]);
  const mountedAt = useRef(new Date().toISOString());
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { active, recent } = await getImportJobsState(mountedAt.current);
        if (stop) return;
        setActive(active);
        for (const job of recent) {
          if (notified.current.has(job.id)) continue;
          notified.current.add(job.id);
          if (job.status === "done") {
            toast.success(
              `Imported ${job.imported_count} product${
                job.imported_count === 1 ? "" : "s"
              } from ${job.label ?? "your price list"}`,
            );
          } else if (job.status === "error") {
            toast.error(
              `Import failed (${job.label ?? "price list"}): ${job.error ?? "unknown error"}`,
            );
          }
          router.refresh();
        }
      } catch {
        /* ignore transient errors */
      }
      // Poll faster while something is running, slower when idle.
      if (!stop) timer = setTimeout(poll, active.length ? 3000 : 8000);
    };

    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (active.length === 0) return null;

  return (
    <div className="border-b bg-primary/5 px-4 py-2">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        {active.map((job) => {
          const pct =
            job.total_chunks > 0
              ? Math.round((job.processed_chunks / job.total_chunks) * 100)
              : job.status === "processing"
                ? 50
                : 0;
          return (
            <div key={job.id} className="flex items-center gap-3 text-sm">
              {job.status === "done" ? (
                <PackageCheck className="size-4 shrink-0 text-primary" />
              ) : (
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              )}
              <span className="min-w-0 truncate font-medium">
                Importing {job.label ?? "price list"}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {job.total_chunks > 1
                  ? `${job.processed_chunks}/${job.total_chunks}`
                  : "working…"}
                {job.imported_count > 0 ? ` · ${job.imported_count} found` : ""}
              </span>
            </div>
          );
        })}
        <p className="text-xs text-muted-foreground">
          You can keep working — this runs in the background.
        </p>
      </div>
    </div>
  );
}

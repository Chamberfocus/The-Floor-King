"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, PackageCheck, XCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getImportJobsState } from "@/app/(app)/catalog/import-actions";
import type { ImportJob } from "@/lib/data/import-jobs";

/**
 * Live, app-wide indicator for background imports. Polls every few seconds so
 * the user sees progress from any page and gets a toast when one finishes.
 */
export function ImportJobsBanner() {
  const router = useRouter();
  const [active, setActive] = useState<ImportJob[]>([]);
  const [finished, setFinished] = useState<ImportJob | null>(null);
  const mountedAt = useRef(new Date().toISOString());
  const notified = useRef<Set<string>>(new Set());
  const nudging = useRef<Set<string>>(new Set());

  // Drive a job forward: ask the worker to process one batch. Guarded so we
  // never run two batches for the same job from this tab at once.
  const nudge = async (jobId: string) => {
    if (nudging.current.has(jobId)) return;
    nudging.current.add(jobId);
    try {
      await fetch("/api/import/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
    } catch {
      /* the next poll will retry */
    } finally {
      nudging.current.delete(jobId);
    }
  };

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { active, recent } = await getImportJobsState(mountedAt.current);
        if (stop) return;
        setActive(active);
        // Keep each running job moving (server processes one batch per call).
        for (const job of active) void nudge(job.id);
        for (const job of recent) {
          if (notified.current.has(job.id)) continue;
          notified.current.add(job.id);
          // Show a clear confirmation dialog (most recent wins).
          setFinished(job);
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

  return (
    <>
      <CompletionDialog
        job={finished}
        onClose={() => setFinished(null)}
      />
      {active.length > 0 ? <ProgressBar active={active} /> : null}
    </>
  );
}

function CompletionDialog({
  job,
  onClose,
}: {
  job: ImportJob | null;
  onClose: () => void;
}) {
  const ok = job?.status === "done";
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            {ok ? (
              <CheckCircle2 className="size-6 text-primary" />
            ) : (
              <XCircle className="size-6 text-destructive" />
            )}
            <DialogTitle>
              {ok ? "Import complete" : "Import failed"}
            </DialogTitle>
          </div>
          <DialogDescription>
            {ok ? (
              <>
                Added{" "}
                <strong className="text-foreground">
                  {job?.imported_count} product
                  {job?.imported_count === 1 ? "" : "s"}
                </strong>{" "}
                to your catalog from{" "}
                <strong className="text-foreground">
                  {job?.label ?? "your price list"}
                </strong>
                .
              </>
            ) : (
              <>
                We couldn&apos;t finish importing{" "}
                <strong className="text-foreground">
                  {job?.label ?? "your price list"}
                </strong>
                : {job?.error ?? "unknown error"}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {ok ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Keep working
              </Button>
              <Link
                href="/catalog"
                onClick={onClose}
                className={buttonVariants()}
              >
                View catalog
              </Link>
            </>
          ) : (
            <Button onClick={onClose}>Got it</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({ active }: { active: ImportJob[] }) {
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

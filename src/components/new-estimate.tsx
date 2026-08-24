"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ClipboardList, Zap, Sparkles, Copy, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstimateStatusBadge } from "@/components/estimate-status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import {
  createEstimate,
  customerWorkContext,
  duplicateEstimateToCustomer,
} from "@/app/(app)/estimates/actions";
import { setCustomerSource } from "@/app/(app)/customers/actions";
import { SourceFields } from "@/app/(app)/customers/source-fields";
import type { LeadSourceRow, EstimateStatus } from "@/lib/types";

type Ctx = Awaited<ReturnType<typeof customerWorkContext>>;

/**
 * The one way to start an estimate.
 *
 * There were four tools — the guided questionnaire, a quick few-lines estimate,
 * the raw builder, and copying a previous quote — and three different launchers,
 * each offering a DIFFERENT SUBSET of them. The customer's own file, which is
 * where you're standing when they ring, offered two of the four; it couldn't
 * copy their last quote even though repeat work is the whole point of a repeat
 * customer. Quick estimate existed only as a button on the estimates list. Which
 * tools you were allowed depended on where you happened to be.
 *
 * One button, one dialog, all four, everywhere. Copy only appears when there is
 * something to copy.
 *
 * The lead-source gate survives intact: createEstimate refuses a customer with
 * no recorded source, so if it's missing this captures it inline and carries on
 * rather than bouncing you to their file with no explanation.
 */
export function NewEstimate({
  customerId,
  sources,
  /** Skips the fetch when the page already knows (the customer file does). */
  sourceOk: knownSourceOk,
  label = "New estimate",
  size = "sm",
}: {
  customerId: string;
  sources: LeadSourceRow[];
  sourceOk?: boolean;
  label?: string;
  size?: "sm" | "lg";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [askSource, setAskSource] = useState<null | (() => void)>(null);
  const [pending, start] = useTransition();

  // Past quotes (and the real source status) are only needed once the dialog is
  // actually opened — no reason to query for a button nobody pressed.
  useEffect(() => {
    if (!open || ctx) return;
    let live = true;
    customerWorkContext(customerId)
      .then((c) => {
        if (live) setCtx(c);
      })
      .catch(() => {
        if (live) setCtx({ sourceOk: knownSourceOk ?? true, estimates: [] });
      });
    return () => {
      live = false;
    };
  }, [open, ctx, customerId, knownSourceOk]);

  const sourceOk = ctx?.sourceOk ?? knownSourceOk ?? true;

  /** Run `go`, unless we still owe a lead source — then ask, and run it after. */
  const gated = (go: () => void) => () => {
    if (sourceOk) go();
    else setAskSource(() => go);
  };

  const goGuided = gated(() => {
    router.push(`/estimates/guided?customer=${customerId}`);
  });

  const goQuick = gated(() => {
    router.push(`/estimates/quick?customer=${customerId}`);
  });

  const goBuilder = gated(() =>
    start(async () => {
      const fd = new FormData();
      fd.set("customer_id", customerId);
      await createEstimate(fd); // redirects into the builder on success
    }),
  );

  const copy = (estimateId: string) =>
    start(async () => {
      const res = await duplicateEstimateToCustomer(estimateId, customerId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Copied — opening the draft");
      router.push(`/estimates/${res.estimateId}/edit`);
    });

  const saveSource = (fd: FormData) =>
    start(async () => {
      fd.set("customer_id", customerId);
      const res = await setCustomerSource(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setCtx((c) => (c ? { ...c, sourceOk: true } : c));
      const go = askSource;
      setAskSource(null);
      go?.();
    });

  const option = (
    icon: React.ReactNode,
    title: string,
    blurb: string,
    onClick: () => void,
  ) => (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left hover:border-primary hover:bg-primary/5 disabled:opacity-60"
    >
      <span className="mt-0.5 shrink-0 text-primary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{blurb}</span>
      </span>
    </button>
  );

  return (
    <>
      <Button
        type="button"
        size={size}
        data-tour="build-estimate"
        onClick={() => setOpen(true)}
      >
        <Plus className={size === "lg" ? "size-4" : "size-3.5"} /> {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New estimate</DialogTitle>
            <DialogDescription>
              All three build the same estimate underneath — pick whichever suits
              the job in front of you.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {option(
              <ClipboardList className="size-4" />,
              "Guided questionnaire",
              "Walk the job room by room. Answer what applies, skip the rest.",
              goGuided,
            )}
            {option(
              <Zap className="size-4" />,
              "Quick estimate",
              "A few lines and a number, without the questionnaire.",
              goQuick,
            )}
            {option(
              <Sparkles className="size-4" />,
              "Build it myself",
              "Straight into the builder with an empty draft.",
              goBuilder,
            )}
          </div>

          {/* Repeat work is the normal case for a customer you've had before —
              copying what you already quoted beats rebuilding it from nothing.
              This was only ever offered on /estimates/start, never on the
              customer's own file, which is the one place it obviously belongs. */}
          {ctx?.estimates.length ? (
            <div className="border-t pt-3">
              <div className="mb-2 text-sm font-medium">
                Or copy what you quoted before
              </div>
              <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
                {ctx.estimates.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <Link
                          href={`/estimates/${e.id}`}
                          className="block truncate text-sm font-medium hover:underline"
                        >
                          {e.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(e.createdAt)}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <EstimateStatusBadge status={e.status as EstimateStatus} />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => copy(e.id)}
                      >
                        <Copy className="size-3.5" /> Copy
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                A copy brings every room, option and price across as a fresh
                draft — point it at a different address once it opens.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Missing lead source: capture it here and carry on to whatever they
          picked, rather than refusing and redirecting with no explanation. */}
      <Dialog open={!!askSource} onOpenChange={(v) => !v && setAskSource(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>How did this lead find us?</DialogTitle>
            <DialogDescription>
              Required before an estimate — takes a few seconds. We&apos;ll
              continue right after.
            </DialogDescription>
          </DialogHeader>
          <form action={saveSource} className="space-y-4">
            <SourceFields sources={sources} />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Saving…" : "Save & continue →"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

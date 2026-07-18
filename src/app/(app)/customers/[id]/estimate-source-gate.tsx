"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createEstimate } from "@/app/(app)/estimates/actions";
import { setCustomerSource } from "../actions";
import { SourceFields } from "../source-fields";
import type { LeadSourceRow } from "@/lib/types";

/**
 * The estimate-creation buttons, gated on a recorded lead source. If the source
 * (and its required sub-detail) is missing, the button opens a small inline
 * dialog — set it in a few taps, then it continues to the estimate. No bounce
 * to another page, no lost place.
 */
export function EstimateSourceGate({
  customerId,
  sourceOk,
  sources,
}: {
  customerId: string;
  sourceOk: boolean;
  sources: LeadSourceRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<"build" | "guided">("build");
  const [pending, start] = useTransition();

  const proceed = (which: "build" | "guided") => {
    if (which === "guided") {
      router.push(`/estimates/guided?customer=${customerId}`);
      return;
    }
    start(async () => {
      const fd = new FormData();
      fd.set("customer_id", customerId);
      await createEstimate(fd); // redirects to the builder on success
    });
  };

  const onClick = (which: "build" | "guided") => {
    if (sourceOk) proceed(which);
    else {
      setTarget(which);
      setOpen(true);
    }
  };

  const save = (fd: FormData) =>
    start(async () => {
      fd.set("customer_id", customerId);
      const res = await setCustomerSource(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      proceed(target);
    });

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => onClick("guided")}>
        <ClipboardList className="size-3.5" /> Guided questionnaire
      </Button>
      <Button type="button" size="sm" disabled={pending} onClick={() => onClick("build")}>
        <Sparkles className="size-3.5" /> Build estimate
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>How did this lead find us?</DialogTitle>
            <DialogDescription>
              Required before an estimate — takes a few seconds. We&apos;ll continue right after.
            </DialogDescription>
          </DialogHeader>
          <form action={save} className="space-y-4">
            <SourceFields sources={sources} />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Saving…" : "Save & continue →"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

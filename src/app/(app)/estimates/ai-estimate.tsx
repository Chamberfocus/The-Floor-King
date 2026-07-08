"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles, Wand2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { draftEstimateFromText } from "./ai-actions";

/**
 * AI Estimate Generator — type the job in plain English and the AI builds a
 * REAL, itemized estimate in the system (rooms parsed, materials matched to the
 * catalog, correct units, pad pulled from the catalog, separate material/labor
 * lines), then opens the edit builder so you review & adjust before finalizing.
 * Nothing is auto-finalized.
 */
export function AiEstimate({
  customerId,
  customerName,
  serviceAddressId,
}: {
  customerId: string;
  customerName: string;
  serviceAddressId: string;
}) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  const generate = () =>
    start(async () => {
      if (text.trim().length < 4) {
        toast.error("Describe the job first.");
        return;
      }
      // On success the action redirects to the edit builder; only errors return.
      const res = await draftEstimateFromText(
        customerId,
        text,
        serviceAddressId || undefined,
      );
      if (res?.error) toast.error(res.error);
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Type everything you know about the job — rooms, sizes, floor types,
        extras — in plain words. The AI itemizes it against your catalog and
        opens it for you to review &amp; edit. Nothing is sent until you say so.
      </p>

      <Card className="border-primary/30">
        <CardContent className="space-y-3 p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Wand2 className="size-4 text-primary" /> Describe the job
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder={
              "e.g. Master bedroom 14x16 and two bedrooms about 12x12 in a plush carpet with new pad.\n" +
              "Living room and hallway ~420 sq ft luxury vinyl plank, tear out the old carpet.\n" +
              "Kitchen 120 sq ft tile. Move the furniture. Metal transitions between the rooms."
            }
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Include a size for each area (L×W or sq ft) and the floor type.
              Unmatched products come in priced from your catalog defaults for
              you to confirm — never guessed.
            </p>
            <Button type="button" onClick={generate} disabled={pending}>
              {pending ? (
                <>
                  <Sparkles className="size-4 animate-pulse" /> Building estimate…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" /> Generate estimate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Tip: for {customerName || "this customer"}, the more detail you give
        (room names, exact sizes, product styles), the closer the draft — but you
        can fix anything on the next screen.
      </p>
    </div>
  );
}

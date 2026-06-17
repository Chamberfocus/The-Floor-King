"use client";

import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles, Wand2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { draftEstimateFromText } from "@/app/(app)/estimates/ai-actions";

export function AiQuote({ customerId }: { customerId: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pending, start] = useTransition();

  const draft = () =>
    start(async () => {
      const text = ref.current?.value ?? "";
      const res = await draftEstimateFromText(customerId, text);
      // On success the action redirects; only errors come back.
      if (res?.error) toast.error(res.error);
    });

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="size-4 text-primary" /> Quote from a description
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <textarea
          ref={ref}
          rows={3}
          placeholder="Describe the job in plain words — e.g. &ldquo;3 bedrooms about 540 sq ft carpet, stairs + hallway carpet, living room 320 sq ft luxury vinyl, kitchen 120 sq ft tile.&rdquo;"
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            AI builds the line items, matches your catalog, and prices to your
            margin — then opens the quote builder to review.
          </p>
          <Button type="button" size="sm" onClick={draft} disabled={pending}>
            {pending ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Building…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Draft quote
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

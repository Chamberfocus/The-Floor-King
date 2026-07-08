"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Star, RotateCcw, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveJobSatisfaction, type WOState } from "./wo-actions";
import type { JobSatisfaction } from "@/lib/data/jobs";

const initial: WOState = { error: null };

/** Canvas signature pad → writes a PNG data-URL into a hidden input. */
function SignaturePad({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Size the backing store to the element for crisp lines.
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasInk(true);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (inputRef.current && canvasRef.current) {
      inputRef.current.value = hasInk ? canvasRef.current.toDataURL("image/png") : "";
    }
  };
  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Customer signature</label>
        <button type="button" onClick={clear} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <RotateCcw className="size-3" /> Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-input bg-background"
      />
      <input ref={inputRef} type="hidden" name={name} />
    </div>
  );
}

export function SatisfactionForm({
  jobId,
  existing,
}: {
  jobId: string;
  existing: JobSatisfaction | null;
}) {
  const [state, action, pending] = useActionState(saveJobSatisfaction, initial);
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [done, setDone] = useState(!!existing);

  useEffect(() => {
    if (state.ok) {
      toast.success("Thank you — satisfaction saved");
      setDone(true);
    }
  }, [state.ok]);

  if (done && existing) {
    return (
      <Card className="border-emerald-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Check className="size-4 text-emerald-600" /> Customer satisfaction — signed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {existing.rating ? (
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} className={cn("size-4", n <= (existing.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted")} />
              ))}
            </div>
          ) : null}
          {existing.comments ? <p className="text-muted-foreground">“{existing.comments}”</p> : null}
          {existing.signature ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={existing.signature} alt="Customer signature" className="h-20 rounded border bg-white" />
          ) : null}
          <p className="text-xs text-muted-foreground">
            {existing.signed_name ? `${existing.signed_name} · ` : ""}
            {new Date(existing.signed_at).toLocaleString()}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-base">Customer satisfaction sign-off</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="rating" value={rating} />
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Overall rating</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                  <Star className={cn("size-8", n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Comments (optional)</label>
            <textarea
              name="comments"
              rows={2}
              placeholder="How did everything go?"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Customer name</label>
            <Input name="signed_name" placeholder="Printed name" className="max-w-xs" />
          </div>
          <SignaturePad name="signature" />
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Save signed sign-off"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

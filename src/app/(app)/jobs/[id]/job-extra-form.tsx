"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signJobExtra } from "../extra-actions";
import { formatMoney } from "@/lib/format";
import type { JobExtraRow } from "@/lib/data/job-ticket";

function SignaturePad({ name }: { name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);
  const inked = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111827";
    }
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Customer signature</label>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            if (inputRef.current) inputRef.current.value = "";
            inked.current = false;
          }}
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-24 w-full touch-none rounded-md border bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          canvasRef.current!.setPointerCapture(e.pointerId);
          const ctx = canvasRef.current!.getContext("2d")!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current!.getContext("2d")!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          inked.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (inputRef.current && canvasRef.current && inked.current) {
            inputRef.current.value = canvasRef.current.toDataURL("image/png");
          }
        }}
      />
      <input ref={inputRef} type="hidden" name={name} />
    </div>
  );
}

export function JobExtraForm({
  jobId,
  extras,
}: {
  jobId: string;
  extras: JobExtraRow[];
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const reactId = useId();
  const [opKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `extra-${reactId}`,
  );

  return (
    <div className="space-y-3">
      {extras.length ? (
        <ul className="space-y-1 text-sm">
          {extras.map((extra) => (
            <li key={extra.id} className="flex justify-between gap-3">
              <span>
                {extra.description}
                <span className="text-muted-foreground"> · {extra.signerName}</span>
              </span>
              <span className="font-medium tabular-nums">{formatMoney(extra.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          fd.set("job_id", jobId);
          fd.set("idempotency_key", opKey);
          start(async () => {
            const res = await signJobExtra(fd);
            if (res.error) {
              toast.error(res.error);
              return;
            }
            toast.success("Signed. It's on their bill.");
            form.reset();
            router.refresh();
          });
        }}
      >
        <Input name="description" required placeholder="What was added" />
        <Input
          name="amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          required
          placeholder="Amount"
        />
        <Input name="signer_name" required placeholder="Customer name" />
        <SignaturePad name="signature" />
        <p className="text-xs text-muted-foreground">
          This amount is added to their bill. If the invoice charges tax, tax is added the same way as the other lines.
        </p>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Customer signs"}
        </Button>
      </form>
    </div>
  );
}

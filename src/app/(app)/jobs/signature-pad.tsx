"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { jobFilesObjectPathError } from "@/lib/job-files-path";
import { recordJobFile } from "./file-actions";

type CanvasEvent =
  | React.MouseEvent<HTMLCanvasElement>
  | React.TouchEvent<HTMLCanvasElement>;

export function SignaturePad({ jobId }: { jobId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  function point(e: CanvasEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const cx = "touches" in e ? e.touches[0].clientX : e.clientX;
    const cy = "touches" in e ? e.touches[0].clientY : e.clientY;
    return {
      x: (cx - r.left) * (c.width / r.width),
      y: (cy - r.top) * (c.height / r.height),
    };
  }

  function start(e: CanvasEvent) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: CanvasEvent) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  }

  function save() {
    const c = canvasRef.current!;
    setBusy(true);
    c.toBlob(async (blob) => {
      if (!blob) {
        setBusy(false);
        return;
      }
      const supabase = createClient();
      const path = `${jobId}/signature-${Date.now()}.png`;
      const pathErr = jobFilesObjectPathError(jobId, path);
      if (pathErr) {
        toast.error(pathErr);
        setBusy(false);
        return;
      }
      const { error } = await supabase.storage
        .from("job-files")
        .upload(path, blob, { contentType: "image/png", upsert: false });
      if (error) {
        toast.error(error.message);
        setBusy(false);
        return;
      }
      const res = await recordJobFile({
        jobId,
        path,
        kind: "signature",
        signerName: name,
      });
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Signature saved");
        clear();
        setName("");
        router.refresh();
      }
      setBusy(false);
    }, "image/png");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={500}
        height={160}
        className="h-40 w-full touch-none rounded-md border bg-white"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Customer name"
          className="max-w-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          Clear
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save signature"}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, Plus, Camera, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { createEstimateFromNotes } from "@/app/(app)/estimates/ai-actions";

/**
 * "Keep building from notes" — after the estimate exists, type or photograph
 * more notes and it appends the new lines to this estimate (same builder logic).
 */
export function AddFromNotes({
  estimateId,
  customerId,
}: {
  estimateId: string;
  customerId: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"type" | "photo">("type");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const done = (err: string | null) => {
    setBusy(null);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success("Added to the estimate");
    if (textRef.current) textRef.current.value = "";
    router.refresh();
  };

  const fromText = () =>
    start(async () => {
      const text = textRef.current?.value ?? "";
      if (!text.trim()) {
        toast.error("Type what to add first.");
        return;
      }
      setBusy("Reading…");
      const res = await createEstimateFromNotes(customerId, { text }, estimateId);
      done(res?.error ?? null);
    });

  const fromPhoto = (file: File) =>
    start(async () => {
      if (file.size > 20 * 1024 * 1024) {
        toast.error("That photo is too large (max 20 MB).");
        return;
      }
      setBusy("Uploading…");
      const supabase = createClient();
      const path = `notes/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) {
        done(`Upload failed: ${upErr.message}`);
        return;
      }
      setBusy("Reading your handwriting…");
      const res = await createEstimateFromNotes(
        customerId,
        { storagePath: path, mime: file.type || "image/jpeg" },
        estimateId,
      );
      done(res?.error ?? null);
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Forgot a room or an add-on? Type it or snap a photo and it gets added to
        this estimate.
      </p>
      <div className="flex gap-2">
        {(
          [
            ["type", Type, "Type it"],
            ["photo", Camera, "Photo"],
          ] as [typeof mode, typeof Type, string][]
        ).map(([m, Icon, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm",
              mode === m ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      {mode === "type" ? (
        <>
          <textarea
            ref={textRef}
            rows={3}
            placeholder={'e.g. "Master closet 6 x 8 carpet $18/yd" or "add 4 transitions $25 each"'}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={fromText} disabled={pending}>
              {pending ? (
                <><Sparkles className="size-4 animate-pulse" /> {busy ?? "Adding…"}</>
              ) : (
                <><Plus className="size-4" /> Add to estimate</>
              )}
            </Button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input p-5 text-center text-sm hover:border-primary/50 hover:bg-muted/40 disabled:opacity-60"
          >
            <Camera className="size-6 text-primary" />
            <span className="font-medium">
              {pending ? (busy ?? "Reading…") : "Photo of the extra notes"}
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) fromPhoto(f);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}

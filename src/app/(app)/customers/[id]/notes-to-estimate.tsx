"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles, Wand2, Camera, Type } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { createEstimateFromNotes } from "@/app/(app)/estimates/ai-actions";

/**
 * One smart front door: type the job (measurements + details) OR snap a photo
 * of your handwritten notes, and it builds the same structured estimate the
 * builder makes — rooms, measurements, materials priced to your margin, install
 * and add-ons — then opens it to continue.
 */
export function NotesToEstimate({ customerId }: { customerId: string }) {
  const [mode, setMode] = useState<"type" | "photo">("type");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  const fromText = () =>
    start(async () => {
      const text = textRef.current?.value ?? "";
      if (!text.trim()) {
        toast.error("Type the job details first.");
        return;
      }
      setBusyMsg("Reading your notes…");
      const res = await createEstimateFromNotes(customerId, { text });
      setBusyMsg(null);
      if (res?.error) toast.error(res.error);
      // success redirects into the builder
    });

  const fromPhoto = (file: File) =>
    start(async () => {
      if (file.size > 20 * 1024 * 1024) {
        toast.error("That photo is too large (max 20 MB).");
        return;
      }
      setBusyMsg("Uploading photo…");
      const supabase = createClient();
      const path = `notes/${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (upErr) {
        setBusyMsg(null);
        toast.error(`Upload failed: ${upErr.message}`);
        return;
      }
      setBusyMsg("Reading your handwriting…");
      const res = await createEstimateFromNotes(customerId, {
        storagePath: path,
        mime: file.type || "image/jpeg",
      });
      setBusyMsg(null);
      if (res?.error) toast.error(res.error);
      // success redirects into the builder
    });

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wand2 className="size-4 text-primary" /> Build from your notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          {(
            [
              ["type", Type, "Type it"],
              ["photo", Camera, "Photo of notes"],
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
              rows={4}
              placeholder={
                "Type the job like your measure sheet — e.g.\nLiving room 15'6\" x 12' carpet, pad + install, tear out old\nMBR 12 x 14 carpet\nHall 3 x 12 LVP\n13 stairs carpet · 2 T-mold"
              }
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Builds the rooms, measurements, materials (priced to your margin),
                install and add-ons — then opens it to review.
              </p>
              <Button type="button" size="sm" onClick={fromText} disabled={pending}>
                {pending ? (
                  <>
                    <Sparkles className="size-4 animate-pulse" /> {busyMsg ?? "Building…"}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" /> Build estimate
                  </>
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
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-input p-6 text-center text-sm hover:border-primary/50 hover:bg-muted/40 disabled:opacity-60"
            >
              <Camera className="size-7 text-primary" />
              <span className="font-medium">
                {pending ? (busyMsg ?? "Reading…") : "Take a photo of your notes"}
              </span>
              <span className="text-xs text-muted-foreground">
                Snap your handwritten measure sheet — it reads it and builds the estimate.
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
      </CardContent>
    </Card>
  );
}

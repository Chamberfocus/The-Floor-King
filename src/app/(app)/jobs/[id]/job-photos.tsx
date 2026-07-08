"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadJobPhoto, type WOState } from "./wo-actions";
import type { CustomerDocument } from "@/lib/types";

const initial: WOState = { error: null };

/** Installer uploads completed-job photos, attached to this work order. */
export function JobPhotos({
  jobId,
  photos,
}: {
  jobId: string;
  photos: (CustomerDocument & { url?: string | null })[];
}) {
  const [state, action, pending] = useActionState(uploadJobPhoto, initial);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      toast.success("Photo uploaded");
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <div className="space-y-3">
      <form ref={formRef} action={action}>
        <input type="hidden" name="job_id" value={jobId} />
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={() => formRef.current?.requestSubmit()}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={pending}>
          <Camera className="size-4" /> {pending ? "Uploading…" : "Add completed photo"}
        </Button>
      </form>

      {photos.length ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) =>
            p.url ? (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" />
              </a>
            ) : null,
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No completed photos yet.</p>
      )}
    </div>
  );
}

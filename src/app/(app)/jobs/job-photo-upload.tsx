"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { recordJobFile } from "./file-actions";

export function JobPhotoUpload({ jobId }: { jobId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList) {
    setBusy(true);
    const supabase = createClient();
    try {
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() || "jpg";
        const rand = Math.random().toString(36).slice(2, 8);
        const path = `${jobId}/${Date.now()}-${rand}.${ext}`;
        const { error } = await supabase.storage
          .from("job-files")
          .upload(path, file);
        if (error) {
          toast.error(error.message);
          continue;
        }
        const res = await recordJobFile({ jobId, path, kind: "photo" });
        if (res.error) toast.error(res.error);
      }
      toast.success("Photos uploaded");
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) =>
          e.target.files?.length ? handleFiles(e.target.files) : undefined
        }
      />
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="size-4" /> {busy ? "Uploading…" : "Upload photos"}
      </Button>
    </div>
  );
}

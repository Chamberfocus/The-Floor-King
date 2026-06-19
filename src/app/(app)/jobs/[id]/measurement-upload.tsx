"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadJobMeasurement, type UploadState } from "./measurement-actions";

const initial: UploadState = { error: null };

/** Field upload: snap/attach a measurement photo or diagram right on the job. */
export function JobMeasurementUpload({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(
    uploadJobMeasurement,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = `job-measure-${jobId}`;

  useEffect(() => {
    if (state.ok) {
      toast.success("Measurement added to the job");
      formRef.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state]);

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="job_id" value={jobId} />
      <input
        id={inputId}
        type="file"
        name="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) e.currentTarget.form?.requestSubmit();
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => document.getElementById(inputId)?.click()}
      >
        <Camera className="size-3.5" />{" "}
        {pending ? "Uploading…" : "Add measurement photo"}
      </Button>
    </form>
  );
}

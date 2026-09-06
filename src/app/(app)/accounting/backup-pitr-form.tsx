"use client";

import { useActionState } from "react";
import { confirmBackupPitrFormAction } from "./actions";
import { PITR_ATTESTATION_PREFIX } from "@/lib/accounting/pitr-attestation";

export function BackupPitrAttestationForm({
  confirmedAt,
}: {
  confirmedAt: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    confirmBackupPitrFormAction,
    null,
  );

  if (confirmedAt) {
    return (
      <p className="text-sm text-emerald-700">
        Confirmed {new Date(confirmedAt).toLocaleString()}. This records your
        external verification only — it does not enable posting.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-xs text-muted-foreground">{PITR_ATTESTATION_PREFIX}</p>
      <label className="block text-sm">
        Verification evidence (min 30 characters)
        <textarea
          name="attestation_evidence"
          required
          minLength={30}
          rows={4}
          placeholder="Example: Verified Supabase PITR on 2026-09-01 via dashboard; 7-day retention confirmed per runbook."
          className="mt-1 block w-full rounded-md border px-2 py-1.5 text-sm"
        />
      </label>
      {state?.error ? (
        <p className="text-sm text-destructive">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p className="text-sm text-emerald-700">Attestation recorded.</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record Backup/PITR attestation"}
      </button>
    </form>
  );
}

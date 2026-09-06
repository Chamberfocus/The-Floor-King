/**
 * F6-P1 backup/PITR owner attestation validation (pure).
 * CRM does NOT verify Supabase backup/PITR — admin attests externally.
 */

export const PITR_ATTESTATION_REQUIRED_MESSAGE =
  "Backup/PITR attestation evidence is required (minimum 30 characters).";

export const PITR_ATTESTATION_PREFIX =
  "OWNER/ADMIN ATTESTATION: Supabase backup and PITR were verified externally.";

export function assessPitrAttestation(evidence: string | null | undefined):
  | { ok: true; normalized: string }
  | { ok: false; error: string } {
  const normalized = String(evidence ?? "").trim();
  if (normalized.length < 30) {
    return { ok: false, error: PITR_ATTESTATION_REQUIRED_MESSAGE };
  }
  return { ok: true, normalized };
}

/** Audit payload fragment — not automated verification. */
export function pitrAttestationAuditPayload(args: {
  evidence: string;
  confirmedAt: string;
  actorId: string | null;
}) {
  return {
    attestationType: "OWNER_ADMIN_EXTERNAL_VERIFICATION",
    automatedVerification: false,
    evidence: args.evidence,
    confirmedAt: args.confirmedAt,
    actorId: args.actorId,
    statement: PITR_ATTESTATION_PREFIX,
  };
}

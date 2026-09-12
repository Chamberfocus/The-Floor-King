/**
 * Synchronous confirm lock. React state is too late to stop a double-mash:
 * both clicks can run before the first re-render. A ref/flag must flip
 * before the action is invoked.
 */
export type ConfirmLockPhase = "idle" | "pending";

export function confirmLockTryBegin(
  phase: ConfirmLockPhase,
): { ok: true; phase: "pending" } | { ok: false; phase: "pending" } {
  if (phase === "pending") return { ok: false, phase: "pending" };
  return { ok: true, phase: "pending" };
}

export function confirmLockSettle(): ConfirmLockPhase {
  return "idle";
}

/** Mutable lock for UI refs. tryBegin is sync and re-entrant-safe. */
export function createConfirmLock() {
  let phase: ConfirmLockPhase = "idle";
  return {
    tryBegin(): boolean {
      const next = confirmLockTryBegin(phase);
      phase = next.phase;
      return next.ok;
    },
    settle() {
      phase = confirmLockSettle();
    },
    isPending() {
      return phase === "pending";
    },
  };
}

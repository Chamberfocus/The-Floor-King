"use client";

import { useId, useState } from "react";

/**
 * Stable per-operation token. Created once when this field mounts and reused
 * for every submit of that form instance (double-click, lost response).
 * A new mount (reload / new credit) gets a new token. Never Date.now().
 */
export function OperationIdempotencyField({
  name = "idempotency_key",
}: {
  name?: string;
}) {
  const reactId = useId();
  const [key] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `op-${reactId}`,
  );
  return <input type="hidden" name={name} value={key} />;
}

/** Fresh idempotency key per mount so double-submit shares one key until remount. */
export function PaymentIdempotencyField() {
  return <OperationIdempotencyField />;
}

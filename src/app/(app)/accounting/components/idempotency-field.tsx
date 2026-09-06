"use client";

import { useId, useState } from "react";

/** Fresh idempotency key per mount for period / CoA control forms. */
export function IdempotencyField({ name = "idempotency_key" }: { name?: string }) {
  const reactId = useId();
  const [key] = useState(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `acct-${reactId}-${Date.now()}`,
  );
  return <input type="hidden" name={name} value={key} />;
}

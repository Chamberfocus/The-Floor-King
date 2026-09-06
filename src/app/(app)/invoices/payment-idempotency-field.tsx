"use client";

import { useId, useState } from "react";

/** Fresh idempotency key per mount so double-submit shares one key until remount. */
export function PaymentIdempotencyField() {
  const reactId = useId();
  const [key] = useState(
    () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `pay-${reactId}-${Date.now()}`,
  );
  return <input type="hidden" name="idempotency_key" value={key} />;
}

"use client";

import { useEffect, useRef } from "react";

/**
 * Records that the customer opened the estimate — one ping on mount.
 *
 * A client beacon rather than logging in the server component, because the
 * server body also runs for prefetches and staff previews; only a real browser
 * mounting this is a real person reading the quote. The API dedupes repeat
 * loads within half an hour, so a refresh doesn't become a second "open".
 */
export function EstimateViewBeacon({ estimateId }: { estimateId: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // keepalive so the ping survives the customer immediately clicking through.
    void fetch("/api/estimate-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimateId }),
      keepalive: true,
    }).catch(() => {});
  }, [estimateId]);
  return null;
}

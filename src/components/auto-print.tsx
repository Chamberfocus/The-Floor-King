"use client";

import { useEffect } from "react";

/**
 * Opens the browser print dialog on mount — used by document routes reached with
 * a `?print=…` link so they open ready to print / save as PDF. Presentation only;
 * it prints whatever the page already renders (the real record's doc), unchanged.
 */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}

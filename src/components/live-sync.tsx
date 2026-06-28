"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps every screen current across devices. When you switch back to a tab
 * (e.g. pick up the laptop after doing something on your phone) it refreshes
 * immediately; while a tab is open and visible it quietly refreshes on an
 * interval so two screens stay in sync.
 *
 * Uses Next's soft `router.refresh()` — it refetches server data and re-renders
 * WITHOUT a full reload, so anything you're typing (an in-progress estimate,
 * a note) is preserved.
 */
export function LiveSync({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const start = () => {
      if (timer == null) timer = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up the moment this screen comes back
        start();
      } else {
        stop(); // don't poll a backgrounded tab
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      stop();
    };
  }, [router, intervalMs]);

  return null;
}

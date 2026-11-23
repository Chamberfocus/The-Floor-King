"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { speakCompanion } from "@/app/(app)/home/companion-actions";
import {
  companionStaysOnFacts,
  firstMove,
  type BallItem,
} from "@/lib/ball-watch";

/**
 * Says the next move out loud. The list is the same rows already on screen.
 * A reply that adds a name or a price is dropped.
 */
export function BallCompanion({
  items,
  showList = true,
}: {
  items: BallItem[];
  showList?: boolean;
}) {
  const [said, setSaid] = useState("");

  useEffect(() => {
    if (!items.length) return;
    let cancelled = false;
    void speakCompanion().then((res) => {
      if (cancelled || !res.text) return;
      if (companionStaysOnFacts(res.text, items)) setSaid(res.text);
    });
    return () => {
      cancelled = true;
    };
    // The list is fixed for this page load. A refresh loads the new facts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!items.length) return null;
  const line = said || firstMove(items);

  return (
    <div className="mt-2">
      {line ? (
        <p aria-live="polite" className="text-sm text-foreground">
          {line}
        </p>
      ) : null}
      {showList ? (
        <ul className="mt-2 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex min-h-11 flex-col justify-center gap-0.5 rounded-lg border bg-card px-4 py-3 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-medium">{item.name}</span>
                <span className="text-sm text-muted-foreground">{item.why}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

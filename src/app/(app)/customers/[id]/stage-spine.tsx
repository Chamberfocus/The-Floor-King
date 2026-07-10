"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type SpineState = "done" | "active" | "upcoming";

/**
 * Presentation-only stage spine. Same stages/flow as before — this just renders
 * the pills cleanly and (the repair) auto-centers the ACTIVE stage in view, so on
 * a phone your current stage is never scrolled off-screen. No flow logic here.
 */
export function StageSpine({
  stages,
}: {
  stages: { name: string; state: SpineState }[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = activeRef.current;
    const box = boxRef.current;
    if (!el || !box) return;
    const left = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    box.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [stages]);

  return (
    <div
      ref={boxRef}
      className="overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ol className="flex min-w-max items-center gap-1">
        {stages.map((s, i) => {
          const active = s.state === "active";
          const done = s.state === "done";
          return (
            <li
              key={i}
              ref={active ? activeRef : undefined}
              className="flex items-center gap-1"
            >
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/25"
                    : done
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-3.5" />
                ) : (
                  <span className="tabular-nums opacity-70">{i + 1}</span>
                )}
                {s.name}
              </span>
              {i < stages.length - 1 ? (
                <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

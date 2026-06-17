"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Sparkles,
  RefreshCw,
  Phone,
  CalendarClock,
  DollarSign,
  Hammer,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import type { DayTask, DayTaskKind } from "@/lib/data/day-tasks";
import { generateBriefing } from "./briefing-actions";

const ICON: Record<DayTaskKind, { icon: typeof Phone; tint: string }> = {
  followup: { icon: Phone, tint: "bg-blue-500/10 text-blue-600" },
  collect: { icon: DollarSign, tint: "bg-emerald-500/10 text-emerald-600" },
  appointment: { icon: CalendarClock, tint: "bg-violet-500/10 text-violet-600" },
  schedule: { icon: Hammer, tint: "bg-amber-500/10 text-amber-600" },
};

export function DayBriefing({
  firstName,
  tasks,
}: {
  firstName: string;
  tasks: DayTask[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const storeKey = `fk-day-${today}`;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [brief, setBrief] = useState("");
  const [pending, start] = useTransition();
  const [showBrief, setShowBrief] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setChecked(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, [storeKey]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(storeKey, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const doneCount = tasks.filter((t) => checked.has(t.id)).length;
  const total = tasks.length;
  const allDone = total > 0 && doneCount === total;

  const runBrief = () =>
    start(async () => {
      const res = await generateBriefing();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setBrief(res.text);
      setShowBrief(true);
    });

  return (
    <Card className="mb-6 overflow-hidden border-primary/30">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-primary/10 to-transparent px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Your day
          </p>
          <h2 className="text-lg font-semibold">
            {total === 0
              ? `You're all caught up, ${firstName} 🎉`
              : allDone
                ? `Nice work, ${firstName} — everything's handled`
                : `Good morning, ${firstName}`}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {total > 0 ? (
            <div className="text-right">
              <div className="text-sm font-semibold">
                {doneCount}/{total}
              </div>
              <div className="text-xs text-muted-foreground">done</div>
            </div>
          ) : null}
          <Button type="button" size="sm" onClick={runBrief} disabled={pending}>
            {pending ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Thinking…
              </>
            ) : brief ? (
              <>
                <RefreshCw className="size-4" /> Re-brief
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Brief my day
              </>
            )}
          </Button>
        </div>
      </div>

      <CardContent className="pt-4">
        {/* AI narrative (optional) */}
        {brief && showBrief ? (
          <div className="mb-4 rounded-lg border bg-muted/30 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" /> AI summary
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {brief}
            </div>
          </div>
        ) : null}

        {/* Checklist */}
        {total === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Nothing needs attention right now. New leads, appointments, and
            payments will show up here as they come in.
          </p>
        ) : (
          <ul className="divide-y">
            {tasks.map((t) => {
              const done = checked.has(t.id);
              const Icon = ICON[t.kind].icon;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(t.id)}
                    aria-label={done ? "Mark not done" : "Mark done"}
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      done
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-input hover:border-primary",
                    )}
                  >
                    {done ? <CheckCircle2 className="size-4" /> : null}
                  </button>

                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      ICON[t.kind].tint,
                      done && "opacity-50",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>

                  <Link
                    href={t.href}
                    className={cn(
                      "group flex min-w-0 flex-1 items-center justify-between gap-2",
                      done && "opacity-50",
                    )}
                  >
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block truncate text-sm font-medium",
                          done && "line-through",
                        )}
                      >
                        {t.title}
                        {t.urgent && !done ? (
                          <span className="ml-2 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            overdue
                          </span>
                        ) : null}
                      </span>
                      {t.sub ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {t.sub}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {t.amount ? (
                        <span className="text-sm font-semibold">
                          {formatMoney(t.amount)}
                        </span>
                      ) : null}
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

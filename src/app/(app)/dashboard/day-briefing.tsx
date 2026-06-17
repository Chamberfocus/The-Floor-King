"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { generateBriefing } from "./briefing-actions";

export function DayBriefing({ firstName }: { firstName: string }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();

  const brief = () =>
    start(async () => {
      const res = await generateBriefing();
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setText(res.text);
    });

  return (
    <Card className="mb-6 border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Your day
              </p>
              <p className="font-semibold">
                {text ? "Here's what to focus on" : `Good morning, ${firstName}`}
              </p>
            </div>
          </div>
          <Button type="button" size="sm" onClick={brief} disabled={pending}>
            {pending ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Thinking…
              </>
            ) : text ? (
              <>
                <RefreshCw className="size-4" /> Refresh
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Brief my day
              </>
            )}
          </Button>
        </div>

        {text ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
        ) : (
          <p className="text-sm text-muted-foreground">
            One click and the AI reads your overdue follow-ups, today&apos;s
            appointments, upcoming installs, and what&apos;s owed — then tells you
            exactly what to tackle first.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

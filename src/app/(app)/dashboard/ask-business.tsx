"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageCircleQuestion, Sparkles, CornerDownLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { askBusiness } from "./ask-actions";

const SUGGESTIONS = [
  "Who owes me money?",
  "How am I doing this month?",
  "Which leads are going cold?",
  "What's my best seller?",
];

export function AskBusiness() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [asked, setAsked] = useState("");
  const [pending, start] = useTransition();

  const ask = (question: string) => {
    const text = question.trim();
    if (!text) return;
    setAsked(text);
    setAnswer("");
    start(async () => {
      const res = await askBusiness(text);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setAnswer(res.answer);
    });
  };

  return (
    <Card className="mb-6 border-primary/30">
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <MessageCircleQuestion className="size-4" />
          </span>
          <p className="font-semibold">Ask your business anything</p>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") ask(q);
              }}
              placeholder="e.g. Who owes me money?"
              className="pr-9"
            />
            <CornerDownLeft className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
          <Button type="button" onClick={() => ask(q)} disabled={pending}>
            {pending ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Thinking…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Ask
              </>
            )}
          </Button>
        </div>

        {!answer && !pending ? (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQ(s);
                  ask(s);
                }}
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {asked && (answer || pending) ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {asked}
            </p>
            {pending ? (
              <p className="text-sm text-muted-foreground">Reading your numbers…</p>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

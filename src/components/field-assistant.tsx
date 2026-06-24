"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles, Send, X, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { askAssistant } from "@/app/(app)/assistant/actions";

const SUGGESTIONS = [
  "What's my next job?",
  "Who do I need to follow up with?",
  "How do I record a deposit?",
  "Carpet for 12'6\" x 14' room — how many yards with 10% waste?",
];

// Minimal typing for the browser speech-recognition API (not in TS lib DOM).
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onerror: () => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};

export function FieldAssistant() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

  const ask = (text?: string) => {
    const question = (text ?? q).trim();
    if (!question || pending) return;
    setQ(question);
    setAnswer(null);
    setErr(null);
    start(async () => {
      const res = await askAssistant(question);
      if (res.error) setErr(res.error);
      else setAnswer(res.text);
    });
  };

  // Hands-free: dictate the question with the device mic (where supported).
  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec })
        .webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results?.[0]?.[0]?.transcript ?? "";
      if (said) setQ((prev) => (prev ? `${prev} ${said}` : said));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <>
      {/* Floating button — sits above the mobile tab bar, respects the notch. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the field assistant"
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-1 ring-black/5 transition active:scale-95 md:bottom-6 print:hidden"
      >
        <Sparkles className="size-6" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" /> Field Assistant
            </SheetTitle>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close">
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {!answer && !err && !pending ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Ask about your jobs, customers, or how to do something — I know
                  your schedule and the trade math.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {pending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Sparkles className="size-4 animate-pulse text-primary" /> Thinking…
              </p>
            ) : null}
            {err ? <p className="text-sm text-destructive">{err}</p> : null}
            {answer ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</div>
            ) : null}
          </div>

          <div className="flex items-end gap-2 border-t p-3">
            <textarea
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              rows={1}
              placeholder="Ask anything…"
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={toggleMic}
              aria-label="Dictate"
              className={cn(listening && "border-primary text-primary")}
            >
              <Mic className="size-5" />
            </Button>
            <Button type="button" size="icon" onClick={() => ask()} disabled={pending} aria-label="Send">
              <Send className="size-5" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

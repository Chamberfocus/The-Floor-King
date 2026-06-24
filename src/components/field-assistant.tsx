"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Send, X, Mic, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  askAssistant,
  runAssistantAction,
  type AssistantAction,
} from "@/app/(app)/assistant/actions";

const SUGGESTIONS = [
  "What's my next job?",
  "Mark my next job complete",
  "Text my next customer I'm on my way",
  "Follow up with my newest lead tomorrow",
  "Draft an estimate: 220 sq ft LVP in the living room",
  "Carpet for 12'6\" x 14' with 10% waste — how many yards?",
];

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [action, setAction] = useState<AssistantAction | null>(null);
  const [done, setDone] = useState<{ message: string; url?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [running, runStart] = useTransition();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

  const clearOut = () => {
    setReply(null);
    setAction(null);
    setDone(null);
    setErr(null);
  };

  const ask = (text?: string) => {
    const question = (text ?? q).trim();
    if (!question || pending) return;
    setQ(question);
    clearOut();
    start(async () => {
      const res = await askAssistant(question);
      if (res.error) setErr(res.error);
      else {
        setReply(res.reply);
        setAction(res.action);
      }
    });
  };

  const confirmAction = () => {
    if (!action || running) return;
    const a = action;
    runStart(async () => {
      const res = await runAssistantAction(a);
      if (!res.ok) {
        setErr(res.message);
        return;
      }
      if (a.type === "navigate" && res.url) {
        setOpen(false);
        router.push(res.url);
        return;
      }
      setAction(null);
      setReply(null);
      setDone({ message: res.message, url: res.url });
      router.refresh();
    });
  };

  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRec;
      webkitSpeechRecognition?: new () => SpeechRec;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
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
            {!reply && !err && !pending && !done ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Ask about your jobs and customers, get things done, or work out
                  the trade math — I know your schedule.
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

            {reply ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{reply}</div>
            ) : null}

            {/* Proposed action — confirm before anything happens */}
            {action ? (
              <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <div className="mb-2 text-sm font-medium">{action.label}</div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={confirmAction} disabled={running}>
                    <Check className="size-4" /> {running ? "Working…" : "Do it"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAction(null)} disabled={running}>
                    Not now
                  </Button>
                </div>
              </div>
            ) : null}

            {/* Result of a completed action */}
            {done ? (
              <div className="mt-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-emerald-700">
                  <Check className="size-4" /> {done.message}
                </div>
                {done.url ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push(done.url!);
                    }}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    View <ArrowRight className="size-3" />
                  </button>
                ) : null}
              </div>
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
              placeholder="Ask or tell me to do something…"
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

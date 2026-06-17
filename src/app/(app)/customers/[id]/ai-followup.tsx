"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sparkles, Copy, Check, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedField } from "@/components/ui/segmented-field";
import { draftFollowup, logFollowup } from "./ai-actions";

export function AiFollowup({ customerId }: { customerId: string }) {
  const [channel, setChannel] = useState<"text" | "email">("text");
  const [draft, setDraft] = useState("");
  const [drafting, startDraft] = useTransition();
  const [logging, startLog] = useTransition();
  const [copied, setCopied] = useState(false);

  const generate = () =>
    startDraft(async () => {
      const res = await draftFollowup(customerId, channel);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setDraft(res.text);
    });

  const copy = async () => {
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast.success("Copied");
  };

  const log = () =>
    startLog(async () => {
      const res = await logFollowup(customerId, channel, draft);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Logged to the timeline");
      setDraft("");
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> AI follow-up
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedField
            size="sm"
            value={channel}
            onChange={(v) => setChannel(v as "text" | "email")}
            options={[
              { value: "text", label: "Text" },
              { value: "email", label: "Email" },
            ]}
          />
          <Button type="button" size="sm" onClick={generate} disabled={drafting}>
            {drafting ? (
              <>
                <Sparkles className="size-4 animate-pulse" /> Writing…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                {draft ? "Rewrite" : "Draft for me"}
              </>
            )}
          </Button>
        </div>

        {draft ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={channel === "email" ? 9 : 5}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                Copy
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={generate}
                disabled={drafting}
              >
                <RefreshCw className="size-4" /> Regenerate
              </Button>
              <Button type="button" size="sm" onClick={log} disabled={logging}>
                {logging ? "Logging…" : "Mark sent & log"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Reads where this job is and what&apos;s happened, then drafts it.
              Edit anything before you send — copy it into your texts/email.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            One click and the AI writes a follow-up based on this customer&apos;s
            stage and history — ready to tweak and send.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

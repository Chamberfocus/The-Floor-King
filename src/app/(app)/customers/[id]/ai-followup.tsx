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
import { SearchPicker } from "@/components/ui/search-picker";
import { draftMessage, logFollowup, type MessageIntent } from "./ai-actions";

const INTENTS: { value: MessageIntent; label: string }[] = [
  { value: "followup", label: "Follow-up" },
  { value: "quote_nudge", label: "Nudge on quote" },
  { value: "appointment_confirm", label: "Confirm appointment" },
  { value: "payment_reminder", label: "Payment reminder" },
  { value: "review_request", label: "Ask for a review" },
  { value: "thank_you", label: "Thank you" },
];

export function AiFollowup({ customerId }: { customerId: string }) {
  const [channel, setChannel] = useState<"text" | "email">("text");
  const [intent, setIntent] = useState<MessageIntent>("followup");
  const [draft, setDraft] = useState("");
  const [drafting, startDraft] = useTransition();
  const [logging, startLog] = useTransition();
  const [copied, setCopied] = useState(false);

  const generate = () =>
    startDraft(async () => {
      const res = await draftMessage(customerId, channel, intent);
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
          <Sparkles className="size-4 text-primary" /> AI message
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <SearchPicker
              value={intent}
              onChange={(v) => setIntent(v as MessageIntent)}
              options={INTENTS}
            />
          </div>
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
              Reads where this job is and what&apos;s happened, then writes it.
              Edit before you send — copy into your texts/email.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pick what you need — a follow-up, a quote nudge, a payment reminder, a
            review request — and AI writes it from this customer&apos;s situation.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

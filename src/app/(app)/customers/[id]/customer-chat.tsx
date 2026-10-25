"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Lock, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SendToClient } from "@/components/send-to-client";
import { cn } from "@/lib/utils";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { formatDateTime } from "@/lib/format";
import type { MessageChannel, MessageWithAuthor } from "@/lib/types";
import { postMessage, type MessageFormState } from "./message-actions";

const initialState: MessageFormState = { error: null };

export function CustomerChat({
  customerId,
  customerName,
  customerEmail,
  messages,
  canMarkOfficeOnly = false,
}: {
  customerId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  messages: MessageWithAuthor[];
  /** Sales and the office can hide a note from the warehouse and installers. */
  canMarkOfficeOnly?: boolean;
}) {
  const [channel, setChannel] = useState<MessageChannel>("internal");
  const [state, formAction, pending] = useActionState(postMessage, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
    if (state.error) toast.error(state.error);
    else if (state.ok && state.notify?.status === "success") {
      toast.success("Message posted and emailed.");
    } else if (state.ok && state.notify?.status === "failed") {
      toast.error(`Message posted, but email failed: ${state.notify.error}`);
    } else if (state.ok && state.notify?.status === "not_attempted") {
      toast.success(`Message posted. Email was not sent: ${state.notify.reason}`);
    }
  }, [state]);

  const list = messages.filter((m) => m.channel === channel);
  const isInternal = channel === "internal";

  return (
    <>
    <RealtimeRefresh table="messages" filter={`customer_id=eq.${customerId}`} />
    <div
      className={cn(
        "overflow-hidden rounded-lg border-2",
        isInternal
          ? "border-amber-400 dark:border-amber-700"
          : "border-blue-400 dark:border-blue-700",
      )}
    >
      {/* Channel tabs */}
      <div className="flex">
        <button
          type="button"
          onClick={() => setChannel("internal")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold transition-colors",
            isInternal
              ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <Lock className="size-4" /> Team — private
        </button>
        <button
          type="button"
          onClick={() => setChannel("client")}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold transition-colors",
            !isInternal
              ? "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200"
              : "text-muted-foreground hover:bg-muted",
          )}
        >
          <MessageSquare className="size-4" /> Customer
        </button>
      </div>

      {/* Banner */}
      <div
        className={cn(
          "px-3 py-2 text-xs font-medium",
          isInternal
            ? "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            : "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
        )}
      >
        {isInternal
          ? "The customer does not see this. Warehouse and installers see it unless you mark it office only."
          : "Visible to the customer."}
      </div>

      {/* Messages */}
      <div className="max-h-80 space-y-3 overflow-y-auto p-3">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isInternal
              ? "No team notes yet. A post here also shows in Shop talk."
              : "No messages with the customer yet."}
          </p>
        ) : (
          list.map((m) => (
            <div key={m.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{m.author_name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(m.created_at)}
                </span>
                {isInternal && m.audience !== "shop" ? (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[11px] font-medium text-amber-950 dark:bg-amber-900 dark:text-amber-100">
                    Office only
                  </span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {m.body}
              </p>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <form
        ref={formRef}
        action={formAction}
        className="space-y-2 border-t p-3"
      >
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="channel" value={channel} />
        <textarea
          name="body"
          rows={2}
          required
          placeholder={
            isInternal
              ? "Write the team about this customer…"
              : "Write a message to the customer…"
          }
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {isInternal ? (
          <>
            {canMarkOfficeOnly ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="audience" value="office" className="mt-1 size-4" />
                <span>Office only — warehouse and installers will not see this</span>
              </label>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/shop-talk?customer=${customerId}`} className="text-xs font-medium text-primary hover:underline">
                Open in Shop talk
              </Link>
              <Button
                type="submit"
                disabled={pending}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                {pending ? "Posting…" : "Post to the team"}
              </Button>
            </div>
          </>
        ) : (
          // Customer messages ask first whether to also email the customer.
          <SendToClient
            clientName={customerName}
            email={customerEmail}
            title="Send this message to the customer?"
            description="It'll show in their project portal. Emailing also sends them a nudge with your message."
            sendLabel="Post & email"
            skipLabel="Post only, no email"
            disabled={pending}
            className="w-full bg-blue-600 text-white hover:bg-blue-700"
          >
            {pending ? "Sending…" : "Send to customer"}
          </SendToClient>
        )}
      </form>
    </div>
    </>
  );
}

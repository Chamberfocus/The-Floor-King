import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { listClientThread } from "@/lib/data/messages";
import { listPortalProjects, portalAuthorNames } from "@/lib/data/portal-projects";
import { portalSpeaker } from "@/lib/portal-dashboard";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { portalSendMessage } from "../actions";

export const metadata: Metadata = { title: "Messages" };

export default async function PortalMessagesPage() {
  const profile = await requireProfile();
  if (!profile.customer_id) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Your account isn&apos;t linked to a project yet.
        </CardContent>
      </Card>
    );
  }

  const customerId = profile.customer_id;
  const [projects, thread] = await Promise.all([
    listPortalProjects(customerId),
    listClientThread(customerId),
  ]);
  const salespersonIds = [...new Set(projects.flatMap((project) => project.salespersonIds))];
  const salespersonNames = [
    ...new Set(projects.map((project) => project.salespersonName).filter((name): name is string => !!name)),
  ];
  const names = await portalAuthorNames(
    thread.map((message) => message.author_id).filter((id): id is string => !!id),
  );

  return (
    <div className="space-y-4">
      <RealtimeRefresh table="messages" filter={`customer_id=eq.${customerId}`} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="text-sm text-muted-foreground">
          {salespersonNames.length
            ? `This goes to the store and to ${salespersonNames.join(" and ")}.`
            : "This goes to the store. Your salesperson sees it too."}
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {thread.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Write below and we&apos;ll see it on your file.
            </p>
          ) : (
            <div className="max-h-[28rem] space-y-3 overflow-y-auto">
              {thread.map((message) => {
                const speaker = portalSpeaker({
                  authorId: message.author_id,
                  viewerId: profile.id,
                  authorName: message.author_id ? names.get(message.author_id) ?? null : null,
                  salespersonIds,
                });
                const mine = speaker.kind === "you";
                return (
                  <div key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted",
                      )}
                    >
                      <div className={cn("text-xs", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                        {speaker.who} · {formatDateTime(message.created_at)}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{message.body}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <form action={portalSendMessage} className="space-y-2 border-t pt-3">
            <label htmlFor="portal-message" className="text-sm font-medium">
              Write a message
            </label>
            <textarea
              id="portal-message"
              name="body"
              rows={3}
              required
              placeholder="Ask about your estimate, your invoice, or the schedule…"
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit">Send</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

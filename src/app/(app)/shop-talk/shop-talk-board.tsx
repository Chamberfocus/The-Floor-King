"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ShopThread } from "@/lib/shop-talk";
import type { ShopConversation, ShopCustomerHit, ShopPost } from "@/lib/data/shop-talk";
import { markShopTalkRead, postShopBoard, postShopMessage, type ShopTalkState } from "./actions";

const initial: ShopTalkState = { error: null };

function shopTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Composer({
  action,
  hidden,
  placeholder,
}: {
  action: (state: ShopTalkState, formData: FormData) => Promise<ShopTalkState>;
  hidden?: { name: string; value: string };
  placeholder: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
    if (state.error) toast.error(state.error);
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2 border-t bg-card p-3">
      {hidden ? <input type="hidden" name={hidden.name} value={hidden.value} /> : null}
      <textarea
        name="body"
        required
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Stays in the company. Does not text or email anyone.</p>
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Post"}
        </Button>
      </div>
    </form>
  );
}

function Bubble({ post, mine }: { post: ShopPost; mine: boolean }) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          mine ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {mine ? null : <div className="mb-0.5 text-xs font-medium">{post.authorName}</div>}
        <p className="whitespace-pre-wrap">{post.body}</p>
        <div className={cn("mt-1 text-[11px]", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
          {shopTime(post.createdAt)} ET
        </div>
      </div>
    </div>
  );
}

export function ShopTalkBoard({
  meId,
  query,
  threads,
  matches,
  shopNotes,
  conversation,
  showShop,
  canOpenCustomer,
}: {
  meId: string;
  query: string;
  threads: ShopThread[];
  matches: ShopCustomerHit[];
  shopNotes: ShopPost[];
  conversation: ShopConversation | null;
  showShop: boolean;
  canOpenCustomer: boolean;
}) {
  const open = showShop || !!conversation;
  const unread = threads.filter((thread) => thread.unread).length;

  useEffect(() => {
    if (conversation?.customerId) void markShopTalkRead(conversation.customerId);
  }, [conversation?.customerId]);

  return (
    <div className="grid min-h-[70vh] overflow-hidden rounded-xl border bg-card lg:grid-cols-[20rem_1fr]">
      <aside className={cn("border-b lg:border-r lg:border-b-0", open ? "hidden lg:block" : "block")}>
        <form action="/shop-talk" className="border-b p-3">
          <label className="relative block">
            <span className="sr-only">Find a customer</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Find a customer"
              className="h-11 w-full rounded-md border border-input bg-transparent pr-3 pl-9 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </form>
        <div className="max-h-[70vh] overflow-y-auto">
          {matches.length ? (
            <div className="border-b p-2">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Matching customers</p>
              <ul>
                {matches.map((hit) => (
                  <li key={hit.id}>
                    <Link
                      href={`/shop-talk?customer=${hit.id}`}
                      className="block rounded-md px-2 py-2 hover:bg-muted"
                    >
                      <div className="text-sm font-medium">{hit.name}</div>
                      {hit.place ? <div className="text-xs text-muted-foreground">{hit.place}</div> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Link
            href="/shop-talk?shop=1"
            className={cn(
              "flex items-start gap-2 border-b px-3 py-3 hover:bg-muted",
              showShop ? "bg-muted" : "",
            )}
          >
            <Store className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block text-sm font-medium">The shop</span>
              <span className="block text-xs text-muted-foreground">
                Not about one customer — truck, dye lot, the day.
              </span>
            </span>
          </Link>
          {threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No customer threads yet. Search a name to start one.
            </p>
          ) : (
            <ul>
              {threads.map((thread) => (
                <li key={thread.customerId}>
                  <Link
                    href={`/shop-talk?customer=${thread.customerId}`}
                    className={cn(
                      "block border-b px-3 py-3 hover:bg-muted",
                      conversation?.customerId === thread.customerId ? "bg-muted" : "",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-sm", thread.unread ? "font-semibold" : "font-medium")}>
                        {thread.customerName}
                      </span>
                      {thread.unread ? (
                        <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="New" />
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{thread.preview}</p>
                    <p className="text-[11px] text-muted-foreground">{shopTime(thread.at)} ET</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {unread ? (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            {unread} customer {unread === 1 ? "thread has" : "threads have"} something new.
          </p>
        ) : null}
      </aside>

      <section className={cn("flex min-h-[70vh] flex-col", open ? "flex" : "hidden lg:flex")}>
        {showShop ? (
          <>
            <header className="flex items-center gap-2 border-b px-3 py-3">
              <Link href="/shop-talk" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted lg:hidden" aria-label="Back to customers">
                <ArrowLeft className="size-5" />
              </Link>
              <div>
                <h2 className="text-base font-semibold">The shop</h2>
                <p className="text-xs text-muted-foreground">Everyone in the company can read this.</p>
              </div>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {shopNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing for the whole shop yet.</p>
              ) : (
                shopNotes.map((post) => <Bubble key={post.id} post={post} mine={post.authorId === meId} />)
              )}
            </div>
            <Composer action={postShopBoard} placeholder="Tell the whole shop…" />
          </>
        ) : conversation ? (
          <>
            <header className="flex items-center justify-between gap-2 border-b px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Link href="/shop-talk" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted lg:hidden" aria-label="Back to customers">
                  <ArrowLeft className="size-5" />
                </Link>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{conversation.customerName}</h2>
                  {conversation.place ? (
                    <p className="truncate text-xs text-muted-foreground">{conversation.place}</p>
                  ) : null}
                </div>
              </div>
              {canOpenCustomer ? (
                <Link href={`/customers/${conversation.customerId}`} className="shrink-0 text-sm font-medium text-primary hover:underline">
                  Customer file
                </Link>
              ) : null}
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-3">
              {conversation.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No one has written about {conversation.customerName} yet. The first note starts the thread.
                </p>
              ) : (
                conversation.messages.map((post) => (
                  <Bubble key={post.id} post={post} mine={post.authorId === meId} />
                ))
              )}
            </div>
            <Composer
              action={postShopMessage}
              hidden={{ name: "customer_id", value: conversation.customerId }}
              placeholder={`Write the team about ${conversation.customerName}…`}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <h2 className="text-base font-semibold">Pick a customer</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Sales, the warehouse, and the installer on that customer all read the same thread.
                The customer does not. Use The shop only when it is not about one person.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

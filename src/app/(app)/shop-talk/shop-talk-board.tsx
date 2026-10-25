"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ListTodo, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ShopThread } from "@/lib/shop-talk";
import { splitShopTasks, tasksForCustomer, type ShopTaskRow } from "@/lib/shop-tasks";
import type { ShopConversation, ShopCustomerHit, ShopPerson, ShopPost } from "@/lib/data/shop-talk";
import { completeOfficeTask } from "@/app/(app)/ops/actions";
import {
  ackShopTask,
  markShopTalkRead,
  postShopBoard,
  postShopMessage,
  sendShopTask,
  type ShopTalkState,
} from "./actions";

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

function useShopForm(
  action: (state: ShopTalkState, formData: FormData) => Promise<ShopTalkState>,
) {
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

  return { formRef, formAction, pending };
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
  const { formRef, formAction, pending } = useShopForm(action);

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

function TaskAsk({
  people,
  customers,
  customerId,
  customerName,
  startClosed,
  tasksMissing,
}: {
  people: ShopPerson[];
  customers: { id: string; name: string }[];
  customerId?: string;
  customerName?: string;
  /** On a customer thread the chat stays first. The to-do form opens on request. */
  startClosed?: boolean;
  tasksMissing?: boolean;
}) {
  const { formRef, formAction, pending } = useShopForm(sendShopTask);
  const [open, setOpen] = useState(!startClosed);
  const field =
    "h-11 w-full rounded-md border border-input bg-transparent px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (!open) {
    return (
      <div className="border-t bg-card p-3">
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          Send a to-do{customerName ? ` about ${customerName}` : ""}
        </Button>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-2 border-t bg-card p-3">
      {tasksMissing ? (
        <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          To-dos are not on the database yet. Run migration 0498_shop_talk_tasks.sql in the Supabase SQL editor, then refresh.
        </p>
      ) : null}
      {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : null}
      <input name="title" required maxLength={200} placeholder="What needs done" className={field} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="assigned_to" required defaultValue="" className={field}>
          <option value="" disabled>
            Who should do it
          </option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} · {person.roleLabel}
            </option>
          ))}
        </select>
        {customerId ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="no_customer" value="1" className="size-4" />
            Not about {customerName ?? "this customer"}
          </label>
        ) : (
          <select name="customer_id" defaultValue="" className={field}>
            <option value="">No customer — just the team</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          They mark it done in Shop talk. You get a notice here. Does not text or email.
        </p>
        <Button type="submit" disabled={pending || people.length === 0}>
          {pending ? "Sending…" : "Send to-do"}
        </Button>
      </div>
    </form>
  );
}

function AckButton({ taskId }: { taskId: string }) {
  const { formRef, formAction, pending } = useShopForm(ackShopTask);
  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="task_id" value={taskId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Got it"}
      </Button>
    </form>
  );
}

function TaskLine({
  task,
  meId,
  canFinishAny,
  showCustomer,
}: {
  task: ShopTaskRow;
  meId: string;
  canFinishAny: boolean;
  showCustomer?: boolean;
}) {
  const mine = task.assignedTo === meId;
  const open = task.status === "open" || task.status === "in_progress";
  const showDone = open && (mine || canFinishAny);
  return (
    <li className="rounded-lg border px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{task.title}</p>
          <p className="text-xs text-muted-foreground">
            {mine ? "For you" : `For ${task.assigneeName}`}
            {task.createdBy && task.createdBy !== meId ? ` · from ${task.senderName}` : ""}
            {showCustomer && task.customerId && task.customerName ? (
              <>
                {" · "}
                <Link href={`/shop-talk?customer=${task.customerId}`} className="underline">
                  {task.customerName}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        {showDone ? (
          <form action={completeOfficeTask}>
            <input type="hidden" name="task_id" value={task.id} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
            >
              Done
            </button>
          </form>
        ) : null}
      </div>
    </li>
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

function todoHint(mine: number, finished: number): string {
  if (finished && mine) return `${finished} finished · ${mine} for you`;
  if (finished === 1) return "1 you sent is finished";
  if (finished) return `${finished} you sent are finished`;
  if (mine === 1) return "1 waiting on you";
  if (mine) return `${mine} waiting on you`;
  return "Send work, and see when it is done.";
}

export function ShopTalkBoard({
  meId,
  query,
  threads,
  matches,
  shopNotes,
  conversation,
  showShop,
  showTasks,
  tasks,
  people,
  tasksMissing,
  canOpenCustomer,
  canFinishAny,
}: {
  meId: string;
  query: string;
  threads: ShopThread[];
  matches: ShopCustomerHit[];
  shopNotes: ShopPost[];
  conversation: ShopConversation | null;
  showShop: boolean;
  showTasks: boolean;
  tasks: ShopTaskRow[];
  people: ShopPerson[];
  tasksMissing: boolean;
  canOpenCustomer: boolean;
  canFinishAny: boolean;
}) {
  const lists = splitShopTasks(tasks, meId);
  const open = showShop || showTasks || !!conversation;
  const unread = threads.filter((thread) => thread.unread).length;
  const attention = lists.mine.length + lists.finished.length;
  const customers = threads.map((thread) => ({ id: thread.customerId, name: thread.customerName }));
  const customerTasks = conversation ? tasksForCustomer(tasks, conversation.customerId) : [];

  useEffect(() => {
    if (conversation?.customerId) void markShopTalkRead(conversation.customerId);
  }, [conversation?.customerId]);

  return (
    <div className="space-y-3">
      {lists.finished.length > 0 && !showTasks ? (
        <Link
          href="/shop-talk?tasks=1"
          className="block rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
        >
          {lists.finished.length === 1
            ? `${lists.finished[0]?.completerName || "Someone"} finished: ${lists.finished[0]?.title}`
            : `${lists.finished.length} to-dos you sent are finished.`}
        </Link>
      ) : null}
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
              href="/shop-talk?tasks=1"
              className={cn(
                "flex items-start gap-2 border-b px-3 py-3 hover:bg-muted",
                showTasks ? "bg-muted" : "",
              )}
            >
              <ListTodo className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="block text-sm font-medium">To-dos</span>
                  {attention ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                      {attention}
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {todoHint(lists.mine.length, lists.finished.length)}
                </span>
              </span>
            </Link>
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
          {showTasks ? (
            <>
              <header className="flex items-center gap-2 border-b px-3 py-3">
                <Link href="/shop-talk" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-muted lg:hidden" aria-label="Back to customers">
                  <ArrowLeft className="size-5" />
                </Link>
                <div>
                  <h2 className="text-base font-semibold">To-dos</h2>
                  <p className="text-xs text-muted-foreground">
                    Send one to anybody in the shop. Tie it to a customer, or leave it as a shop task.
                  </p>
                </div>
              </header>
              <div className="flex-1 space-y-4 overflow-y-auto p-3">
                {tasksMissing ? (
                  <p role="alert" className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                    To-dos are not on the database yet. Run migration 0498_shop_talk_tasks.sql in the Supabase SQL editor, then refresh.
                  </p>
                ) : null}
                {lists.finished.length ? (
                  <section className="space-y-2">
                    <h3 className="text-sm font-semibold">Finished</h3>
                    <ul className="space-y-2">
                      {lists.finished.map((task) => (
                        <li key={task.id} className="flex items-start justify-between gap-2 rounded-lg border border-emerald-500 bg-emerald-50 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {task.completerName || "Someone"} finished: {task.title}
                            </p>
                            {task.customerId && task.customerName ? (
                              <Link href={`/shop-talk?customer=${task.customerId}`} className="text-xs underline">
                                {task.customerName}
                              </Link>
                            ) : (
                              <p className="text-xs text-muted-foreground">Not about a customer</p>
                            )}
                          </div>
                          <AckButton taskId={task.id} />
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">For you</h3>
                  {lists.mine.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing is waiting on you.</p>
                  ) : (
                    <ul className="space-y-2">
                      {lists.mine.map((task) => (
                        <TaskLine key={task.id} task={task} meId={meId} canFinishAny={canFinishAny} showCustomer />
                      ))}
                    </ul>
                  )}
                </section>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">You sent</h3>
                  {lists.sent.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing you sent is still open.</p>
                  ) : (
                    <ul className="space-y-2">
                      {lists.sent.map((task) => (
                        <TaskLine key={task.id} task={task} meId={meId} canFinishAny={canFinishAny} showCustomer />
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              <TaskAsk people={people} customers={customers} />
            </>
          ) : showShop ? (
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
                {customerTasks.length ? (
                  <ul className="space-y-2">
                    {customerTasks.map((task) => (
                      <TaskLine key={task.id} task={task} meId={meId} canFinishAny={canFinishAny} />
                    ))}
                  </ul>
                ) : null}
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
              <TaskAsk
                people={people}
                customers={customers}
                customerId={conversation.customerId}
                customerName={conversation.customerName}
                startClosed
                tasksMissing={tasksMissing}
              />
              <Composer
                action={postShopMessage}
                hidden={{ name: "customer_id", value: conversation.customerId }}
                placeholder={`Write the team about ${conversation.customerName}…`}
              />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <h2 className="text-base font-semibold">Pick a customer, or send a to-do</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sales, the warehouse, and the installer on that customer all read the same thread.
                  The customer does not. Use To-dos when someone needs to do something, even if it is not about one person.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

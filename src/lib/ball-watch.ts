/**
 * Who is waiting, from queues the app already has.
 * Home people and office tasks stay the source. This only orders them
 * and writes the reminder. It does not create a second task list.
 */
import { taskOperationalHref } from "@/lib/office-task";
import type { HomePerson } from "@/lib/home-people";

export const BALL_WATCH_CAP = 8;

export type BallItem = {
  id: string;
  name: string;
  why: string;
  href: string;
};

export type WatchTask = {
  id: string;
  title: string | null;
  customer_id?: string | null;
  job_id?: string | null;
  source_key?: string | null;
};

const OVERDUE = "This task is overdue";
const DUE_TODAY = "This task is due today";

function taskPerson(task: WatchTask, why: string, canOpenTaskList: boolean): HomePerson | null {
  const name = task.title?.trim();
  if (!name) return null;
  const href =
    taskOperationalHref({
      source_key: task.source_key,
      customer_id: task.customer_id,
      job_id: task.job_id,
    }) ?? (canOpenTaskList ? `/tasks?view=mine#${task.id}` : null);
  if (!href) return null;
  return { id: `task-${task.id}`, name, why, href };
}

/**
 * Overdue tasks first, then tasks due today, then the named customers
 * already on Home. The same link is kept once. Eight is enough to start.
 */
export function mergeWatchPeople(
  people: readonly HomePerson[],
  tasks: { overdue: readonly WatchTask[]; dueToday: readonly WatchTask[] },
  canOpenTaskList: boolean,
): HomePerson[] {
  const fromTasks: HomePerson[] = [];
  for (const task of tasks.overdue) {
    const row = taskPerson(task, OVERDUE, canOpenTaskList);
    if (row) fromTasks.push(row);
  }
  for (const task of tasks.dueToday) {
    const row = taskPerson(task, DUE_TODAY, canOpenTaskList);
    if (row) fromTasks.push(row);
  }
  const seen = new Set<string>();
  const out: HomePerson[] = [];
  for (const person of [...fromTasks, ...people]) {
    if (seen.has(person.href)) continue;
    seen.add(person.href);
    out.push(person);
    if (out.length >= BALL_WATCH_CAP) break;
  }
  return out;
}

export function ballItemsFromPeople(people: readonly HomePerson[]): BallItem[] {
  return people.map((person) => ({
    id: person.id,
    name: person.name,
    why: person.why,
    href: person.href,
  }));
}

/** The sentence on screen before the model answers, and if the model wanders. */
export function firstMove(items: readonly BallItem[]): string {
  if (!items.length) return "";
  const first = items[0];
  const lead = `${first.name}. ${first.why}.`;
  if (items.length === 1) return lead;
  const rest = items.length - 1;
  return `${lead} ${rest} more ${rest === 1 ? "is" : "are"} also waiting.`;
}

/**
 * The model may only rephrase these lines. Callers drop a reply that
 * names someone else or invents a price.
 */
export function companionBrief(
  items: readonly BallItem[],
): { system: string; prompt: string } | null {
  if (!items.length) return null;
  const lines = items.map((item, i) => `${i + 1}. ${item.name} — ${item.why}`).join("\n");
  return {
    system:
      "You remind a flooring store employee about work that is already waiting. Use only the numbered lines. Do not add a customer, a price, a date, or a task that is not written there. Write two short sentences in plain text. Name who to handle first and why.",
    prompt: `Work already waiting:\n${lines}`,
  };
}

export function companionStaysOnFacts(text: string, items: readonly BallItem[]): boolean {
  const spoken = text.trim();
  if (!spoken || !items.length) return false;
  const facts = items.map((item) => `${item.name} ${item.why}`).join("\n");
  if (spoken.includes("$") && !facts.includes("$")) return false;
  const hay = spoken.toLowerCase();
  const names = items.map((item) => item.name.trim()).filter((name) => name.length >= 3);
  if (!names.length) return hay.includes(items[0].name.trim().toLowerCase());
  return names.some((name) => hay.includes(name.toLowerCase()));
}

export function escapeNudge(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type NudgeCustomer = { name: string; stage: string; action: string };
export type NudgeTask = { title: string };

export type EmployeeNudge = {
  subject: string;
  heading: string;
  innerHtml: string;
  label: string;
  path: string;
};

function customerItems(rows: readonly NudgeCustomer[]): NudgeCustomer[] {
  return rows.filter((row) => row.name.trim());
}

function taskItems(rows: readonly NudgeTask[]): NudgeTask[] {
  return rows.filter((row) => row.title.trim());
}

function customerList(rows: readonly NudgeCustomer[]): string {
  return `<p>These clients are past their target time for the next step:</p><ul>${rows
    .map(
      (row) =>
        `<li><strong>${escapeNudge(row.name)}</strong> — ${escapeNudge(row.stage)}: ${escapeNudge(row.action)}</li>`,
    )
    .join("")}</ul>`;
}

function taskList(rows: readonly NudgeTask[]): string {
  return `<p>These tasks are overdue:</p><ul>${rows
    .map((row) => `<li>${escapeNudge(row.title)}</li>`)
    .join("")}</ul>`;
}

/** One email per employee: stuck clients and overdue tasks together. */
export function employeeNudge(args: {
  customers: readonly NudgeCustomer[];
  tasks: readonly NudgeTask[];
}): EmployeeNudge | null {
  const customers = customerItems(args.customers);
  const tasks = taskItems(args.tasks);
  if (!customers.length && !tasks.length) return null;
  const subject = customers.length
    ? tasks.length
      ? `${customers.length === 1 ? "1 client" : `${customers.length} clients`} and ${tasks.length === 1 ? "1 overdue task" : `${tasks.length} overdue tasks`} need you`
      : `${customers.length === 1 ? "1 client needs" : `${customers.length} clients need`} your attention`
    : `${tasks.length === 1 ? "1 task is overdue" : `${tasks.length} tasks are overdue`}`;
  const heading = customers.length
    ? tasks.length
      ? "Clients and tasks waiting on you"
      : "Clients waiting on you"
    : "Tasks waiting on you";
  const innerHtml = [customers.length ? customerList(customers) : "", tasks.length ? taskList(tasks) : ""]
    .filter(Boolean)
    .join("");
  return {
    subject,
    heading,
    innerHtml,
    label: customers.length ? "See what's past due" : "Open your tasks",
    path: customers.length ? "/client-status?who=mine&overdue=1" : "/tasks?view=mine",
  };
}

/** Owner digest. Same facts, the whole team. */
export function oversightNudge(args: {
  customers: readonly NudgeCustomer[];
  tasks: readonly NudgeTask[];
}): EmployeeNudge | null {
  const customers = customerItems(args.customers);
  const tasks = taskItems(args.tasks);
  if (!customers.length && !tasks.length) return null;
  const subject = customers.length
    ? tasks.length
      ? `${customers.length === 1 ? "1 client is" : `${customers.length} clients are`} stuck too long, and ${tasks.length === 1 ? "1 task is" : `${tasks.length} tasks are`} overdue`
      : `${customers.length === 1 ? "1 client is" : `${customers.length} clients are`} stuck too long`
    : `${tasks.length === 1 ? "1 task is overdue" : `${tasks.length} tasks are overdue`}`;
  const heading = customers.length
    ? "Clients stuck too long — full view"
    : "Overdue tasks — full view";
  const intro = customers.length
    ? `<p>These clients are past their stage's time limit across the whole team, so nothing falls through the cracks:</p>`
    : "";
  const customerHtml = customers.length
    ? `<ul>${customers
        .map(
          (row) =>
            `<li><strong>${escapeNudge(row.name)}</strong> — ${escapeNudge(row.stage)}: ${escapeNudge(row.action)}</li>`,
        )
        .join("")}</ul>`
    : "";
  return {
    subject,
    heading,
    innerHtml: `${intro}${customerHtml}${tasks.length ? taskList(tasks) : ""}`,
    label: "See what's past due",
    path: "/client-status?overdue=1",
  };
}

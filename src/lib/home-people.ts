/**
 * Named rows for Home. The count board stays the full list.
 * These rows are a short slice of the same queues, in the same role order.
 */
import { homeCommandsForRole } from "@/lib/home-command";
import type { UserRole } from "@/lib/types";

export type HomePersonKind = "lead" | "followup" | "decline" | "estimate" | "today";

export type HomePerson = {
  id: string;
  name: string;
  why: string;
  href: string;
};

const KIND_FOR_COMMAND: Partial<Record<string, HomePersonKind>> = {
  leads: "lead",
  followups: "followup",
  declines: "decline",
  estimates: "estimate",
  today: "today",
};

/** Queues this role already sees on Home, in attention order. */
export function homePersonKinds(role: UserRole): HomePersonKind[] {
  const kinds: HomePersonKind[] = [];
  for (const spec of homeCommandsForRole(role)) {
    const kind = KIND_FOR_COMMAND[spec.id];
    if (kind) kinds.push(kind);
  }
  return kinds;
}

export function homePersonWhy(
  kind: HomePersonKind,
  role: UserRole,
  nextAction?: string | null,
): string {
  if (kind === "lead") {
    return role === "salesman" ? "Accept this lead" : "Waiting to be accepted";
  }
  if (kind === "followup") return nextAction?.trim() || "Follow-up is due";
  if (kind === "decline") return "A salesperson declined this lead";
  if (kind === "estimate") return "Estimate is out — follow up";
  return "Install today";
}

export function homePersonName(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed || fallback;
}

/**
 * Up to two from each queue, then fill the rest in the same order.
 * The same link is kept once.
 */
export function pickHomePeople(buckets: readonly (readonly HomePerson[])[], cap = 6): HomePerson[] {
  const picked: HomePerson[] = [];
  const seen = new Set<string>();
  const used = buckets.map(() => new Set<number>());

  const addFrom = (bucketIndex: number, limit: number) => {
    const bucket = buckets[bucketIndex] ?? [];
    let added = 0;
    for (let i = 0; i < bucket.length && added < limit && picked.length < cap; i++) {
      if (used[bucketIndex].has(i)) continue;
      const person = bucket[i];
      used[bucketIndex].add(i);
      if (seen.has(person.href)) continue;
      seen.add(person.href);
      picked.push(person);
      added++;
    }
  };

  for (let i = 0; i < buckets.length; i++) addFrom(i, 2);
  for (let i = 0; i < buckets.length; i++) addFrom(i, cap);
  return picked;
}

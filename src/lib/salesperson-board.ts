/**
 * The owner's view of each salesperson's book.
 * Same work units as Client status. Grouped by the assigned salesperson.
 */
import { CLIENT_STATUS_LANES, clientStatusLane, type ClientLane } from "@/lib/client-status-lanes";
import type { UserRole } from "@/lib/types";
import type { WorkUnit } from "@/lib/work-stage";

export const SALESPERSON_BOARD_ROLES: UserRole[] = ["admin", "office", "sales_manager"];

export type BoardStage = {
  id: string;
  name: string;
  position: number;
  outcome?: "active" | "won" | "lost" | "parked" | null;
};

export type SalespersonClient = {
  key: string;
  customerName: string;
  site: string | null;
  stageName: string;
  laneTitle: string | null;
  next: string;
  href: string;
  stuck: boolean;
  dueAt: string | null;
};

export type SalespersonBook = {
  ownerId: string | null;
  name: string;
  clients: SalespersonClient[];
  stuck: number;
};

const LANE_BY_KEY = new Map(CLIENT_STATUS_LANES.map((lane) => [lane.key, lane]));

export function workIsPastDue(dueAt: string | null | undefined, now = new Date()): boolean {
  return !!dueAt && new Date(dueAt).getTime() < now.getTime();
}

function clientRow(
  unit: WorkUnit,
  stageById: Map<string, BoardStage>,
  now: Date,
): SalespersonClient | null {
  const stage = unit.stageId ? stageById.get(unit.stageId) : undefined;
  let lane: ClientLane | null = null;
  if (stage) {
    lane = clientStatusLane(stage);
    if (!lane) return null;
  }
  const laneInfo = lane ? LANE_BY_KEY.get(lane) : undefined;
  return {
    key: `${unit.kind}-${unit.id}`,
    customerName: unit.customerName?.trim() || "Unnamed customer",
    site: unit.site,
    stageName: stage?.name ?? "No stage set",
    laneTitle: laneInfo?.title ?? null,
    next: laneInfo?.next ?? "Set the stage",
    href: unit.kind === "job" ? `/jobs/${unit.id}` : `/customers/${unit.customerId}`,
    stuck: workIsPastDue(unit.dueAt, now),
    dueAt: unit.dueAt,
  };
}

/** Live work under each salesperson. Closed stages stay off the book. */
export function salespersonBooks(args: {
  units: readonly WorkUnit[];
  stageById: Map<string, BoardStage>;
  names: Record<string, string>;
  now?: Date;
}): SalespersonBook[] {
  const now = args.now ?? new Date();
  const byOwner = new Map<string | null, SalespersonClient[]>();
  for (const unit of args.units) {
    const row = clientRow(unit, args.stageById, now);
    if (!row) continue;
    const id = unit.salespersonId;
    const list = byOwner.get(id) ?? [];
    list.push(row);
    byOwner.set(id, list);
  }
  const books: SalespersonBook[] = [];
  for (const [ownerId, clients] of byOwner) {
    clients.sort((a, b) => {
      if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
      return a.customerName.localeCompare(b.customerName);
    });
    books.push({
      ownerId,
      name: ownerId ? args.names[ownerId]?.trim() || "Unnamed salesperson" : "No salesperson",
      clients,
      stuck: clients.filter((client) => client.stuck).length,
    });
  }
  books.sort((a, b) => {
    if (a.stuck !== b.stuck) return b.stuck - a.stuck;
    if (!a.ownerId) return 1;
    if (!b.ownerId) return -1;
    return a.name.localeCompare(b.name);
  });
  return books;
}

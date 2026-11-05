/**
 * What a customer is told about the stage the store just moved.
 *
 * The name is the workflow stage itself. The progress step is the same lane
 * Client status uses, so a move on the store board moves this screen.
 */
import { stageIsParked } from "@/lib/customer-lifecycle";
import {
  CLIENT_STATUS_LANES,
  clientStatusLane,
  type ClientLane,
} from "@/lib/client-status-lanes";

export interface PortalStageInput {
  id: string;
  name: string;
  position: number;
  outcome?: "active" | "won" | "lost" | "parked" | null;
}

export interface PortalStageView {
  /** The stage name the store saved. */
  name: string;
  detail: string;
  lane: ClientLane | null;
  closed: boolean;
  parked: boolean;
}

const LANE_DETAIL: Record<ClientLane, string> = {
  new: "We have your project and will be in touch.",
  quoting: "We're measuring and writing your estimate.",
  out: "Your estimate is ready. Open it to approve it, ask a question, or request a change.",
  won: "You're approved. We're lining up materials and an installation date.",
  onsite: "Installation is on the calendar or happening now.",
  paying: "The work is finished. Your invoice shows what is left to pay.",
};

/** Short labels on the progress trail. The headline stays the real stage name. */
export const CUSTOMER_LANE_LABEL: Record<ClientLane, string> = {
  new: "Started",
  quoting: "Estimate",
  out: "Your review",
  won: "Getting ready",
  onsite: "Installation",
  paying: "Invoice",
};

export function customerLaneSteps(): { key: ClientLane; label: string }[] {
  return CLIENT_STATUS_LANES.map((lane) => ({
    key: lane.key,
    label: CUSTOMER_LANE_LABEL[lane.key],
  }));
}

export function presentPortalStage(stage: PortalStageInput | null): PortalStageView {
  if (!stage) {
    return {
      name: "Getting started",
      detail: LANE_DETAIL.new,
      lane: "new",
      closed: false,
      parked: false,
    };
  }
  const lane = clientStatusLane(stage);
  const parked = stageIsParked(stage);
  if (!lane) {
    return {
      name: stage.name,
      detail: "This project is closed. Message the store if that doesn't look right.",
      lane: null,
      closed: true,
      parked: false,
    };
  }
  if (parked) {
    return {
      name: stage.name,
      detail: "This project is on hold. Send a message when you want to pick it back up.",
      lane,
      closed: false,
      parked: true,
    };
  }
  return {
    name: stage.name,
    detail: LANE_DETAIL[lane],
    lane,
    closed: false,
    parked: false,
  };
}

export interface PortalSpeaker {
  who: string;
  kind: "you" | "salesperson" | "store";
}

/**
 * A client-channel message. The salesperson is whoever owns the project.
 * Everyone else at the company is the store. Team-only notes never arrive here.
 */
export function portalSpeaker(args: {
  authorId: string | null;
  viewerId: string;
  authorName: string | null;
  salespersonIds: string[];
}): PortalSpeaker {
  if (args.authorId && args.authorId === args.viewerId) {
    return { who: "You", kind: "you" };
  }
  const name = (args.authorName ?? "").trim();
  const salesperson =
    !!args.authorId && args.salespersonIds.includes(args.authorId);
  if (salesperson) {
    return { who: name ? `${name} · Your salesperson` : "Your salesperson", kind: "salesperson" };
  }
  return { who: name ? `${name} · The store` : "The store", kind: "store" };
}

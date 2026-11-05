/**
 * The six lanes on Client status.
 *
 * Stages fold in by position, so a renamed stage or one inserted in the middle
 * lands in the same lane on the store board and on the customer dashboard.
 */
import { stageIsLost } from "@/lib/customer-lifecycle";

export type ClientLane = "new" | "quoting" | "out" | "won" | "onsite" | "paying";

export const CLIENT_STATUS_LANES: {
  key: ClientLane;
  title: string;
  hint: string;
  accent: string;
  /** What the store does next. Not shown to the customer. */
  next: string;
}[] = [
  { key: "new", title: "New", hint: "Nothing booked yet", accent: "border-slate-400", next: "Call and book the measure" },
  { key: "quoting", title: "To quote", hint: "Measure booked or in hand", accent: "border-amber-400", next: "Build and send the estimate" },
  { key: "out", title: "Quote out", hint: "Waiting on the customer", accent: "border-blue-400", next: "Follow it up" },
  { key: "won", title: "Won — getting ready", hint: "Deposit, materials, scheduling", accent: "border-violet-400", next: "Order material and book the install" },
  { key: "onsite", title: "On site", hint: "Installing now", accent: "border-emerald-400", next: "Finish and get sign-off" },
  { key: "paying", title: "Getting paid", hint: "Work done, money outstanding", accent: "border-rose-400", next: "Collect the balance" },
];

export function clientStatusLane(stage: {
  name: string;
  position: number;
  outcome?: "active" | "won" | "lost" | "parked" | null;
}): ClientLane | null {
  if (stageIsLost(stage)) return null;
  if (/closed/i.test(stage.name)) return null;
  if (stage.position < 30) return "new";
  if (stage.position < 50) return "quoting";
  if (stage.position < 65) return "out";
  if (stage.position < 105) return "won";
  if (stage.position < 110) return "onsite";
  return "paying";
}

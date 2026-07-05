"use server";

import { myStopsToday, type MyStop } from "@/lib/data/my-stops";

/** Client-callable wrapper so the floating "On my way" button can load today's
 *  stops for the signed-in rep. */
export async function fetchMyStopsToday(): Promise<MyStop[]> {
  return myStopsToday();
}

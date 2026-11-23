"use server";

import { aiText } from "@/lib/ai";
import { requireProfile } from "@/lib/auth";
import { loadBallPeople } from "@/lib/data/ball-watch";
import { ballItemsFromPeople, companionBrief } from "@/lib/ball-watch";

/** Rewrites the signed-in person's waiting list. The list is loaded here, not from the browser. */
export async function speakCompanion(): Promise<{ text: string }> {
  const profile = await requireProfile();
  if (profile.role === "customer") return { text: "" };
  const people = await loadBallPeople({ role: profile.role, userId: profile.id });
  const brief = companionBrief(ballItemsFromPeople(people));
  if (!brief) return { text: "" };
  const res = await aiText({
    system: brief.system,
    prompt: brief.prompt,
    maxTokens: 160,
    temperature: 0.2,
  });
  if (res.error) return { text: "" };
  return { text: res.text.trim() };
}

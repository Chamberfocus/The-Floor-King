import { requireProfile } from "@/lib/auth";
import { loadBallPeople } from "@/lib/data/ball-watch";
import { ballItemsFromPeople } from "@/lib/ball-watch";
import { BallCompanion } from "@/components/ball-companion";

/** The same waiting list Home shows, for the desks that do not open Home first. */
export async function BallWatch() {
  const profile = await requireProfile();
  if (profile.role === "customer") return null;
  const people = await loadBallPeople({ role: profile.role, userId: profile.id });
  const items = ballItemsFromPeople(people);
  if (!items.length) return null;
  return (
    <section aria-labelledby="ball-watch-heading" className="mb-6">
      <h2 id="ball-watch-heading" className="text-sm font-semibold">
        Who needs you
      </h2>
      <BallCompanion items={items} />
    </section>
  );
}

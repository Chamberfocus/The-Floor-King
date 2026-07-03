/**
 * Drive-time ETA via the Google Distance Matrix API. SERVER ONLY.
 * Needs GOOGLE_MAPS_API_KEY and STORE_ADDRESS (your shop). No-ops without them.
 */
export function storeAddress(): string {
  return process.env.STORE_ADDRESS || "";
}

/**
 * One-origin → many-destinations drive matrix (minutes + miles) in a single
 * Distance Matrix call. Used by the smart scheduler to score, in one shot, how
 * far a new estimate is from a rep's home base and each of that day's existing
 * stops — so it can insert the estimate where it adds the least drive & fuel.
 * Returns an aligned array (null per entry it couldn't resolve). No-ops (all
 * null) without GOOGLE_MAPS_API_KEY.
 */
export async function getDriveMatrix(
  origin: string,
  destinations: string[],
): Promise<({ minutes: number; miles: number } | null)[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !origin || destinations.length === 0) {
    return destinations.map(() => null);
  }
  const dest = destinations.map((d) => encodeURIComponent(d)).join("%7C"); // "|"
  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(origin)}` +
    `&destinations=${dest}` +
    "&departure_time=now&units=imperial" +
    `&key=${key}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const els = data?.rows?.[0]?.elements ?? [];
    return destinations.map((_, i) => {
      const el = els[i];
      if (!el || el.status !== "OK") return null;
      const dur = el.duration_in_traffic ?? el.duration;
      if (!dur) return null;
      const meters = el.distance?.value ?? 0;
      return {
        minutes: Math.round(dur.value / 60),
        miles: Math.round((meters / 1609.34) * 10) / 10,
      };
    });
  } catch {
    return destinations.map(() => null);
  }
}

export async function getDriveTime(
  destination: string,
  originOverride?: string,
): Promise<{ text: string; minutes: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const origin = originOverride || storeAddress();
  if (!key || !origin || !destination) return null;

  const url =
    "https://maps.googleapis.com/maps/api/distancematrix/json" +
    `?origins=${encodeURIComponent(origin)}` +
    `&destinations=${encodeURIComponent(destination)}` +
    "&departure_time=now&units=imperial" +
    `&key=${key}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const el = data?.rows?.[0]?.elements?.[0];
    if (!el || el.status !== "OK") return null;
    const dur = el.duration_in_traffic ?? el.duration;
    if (!dur) return null;
    return { text: dur.text as string, minutes: Math.round(dur.value / 60) };
  } catch {
    return null;
  }
}

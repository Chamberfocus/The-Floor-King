/**
 * Drive-time ETA via the Google Distance Matrix API. SERVER ONLY.
 * Needs GOOGLE_MAPS_API_KEY and STORE_ADDRESS (your shop). No-ops without them.
 */
export function storeAddress(): string {
  return process.env.STORE_ADDRESS || "";
}

export async function getDriveTime(
  destination: string,
): Promise<{ text: string; minutes: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const origin = storeAddress();
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

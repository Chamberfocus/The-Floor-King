import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Proxies Google Street View so the API key stays server-side. Staff only. */
export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new Response("", { status: 404 });

  // Must be a signed-in user (the image is embedded on staff pages).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const lat = sp.get("lat");
  const lng = sp.get("lng");
  const address = sp.get("address");
  const location = lat && lng ? `${lat},${lng}` : address;
  if (!location) return new Response("", { status: 400 });

  const url =
    "https://maps.googleapis.com/maps/api/streetview" +
    `?size=640x360&fov=80&location=${encodeURIComponent(location)}&key=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return new Response("", { status: 502 });
  const buf = await res.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieNames } from "@/lib/auth-session";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Ends the session and expires every auth cookie on this response.
 * A server action could not do that: the session refresh ran first and
 * wrote the old login back, so Sign out appeared to do nothing.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });

  if (isSupabaseConfigured()) {
    try {
      const { url, anonKey } = getSupabaseEnv();
      const supabase = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      });
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      // The cookies below still end the session in this browser.
    }
  }

  for (const name of authCookieNames(request.cookies.getAll())) {
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      expires: new Date(0),
      sameSite: "lax",
      httpOnly: false,
    });
  }

  return response;
}

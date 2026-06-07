import { NextResponse, type NextRequest } from "next/server";
import { processImportJobBatch } from "@/lib/import-worker";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background worker for import jobs — processes one batch (within a time budget)
 * and returns whether work remains. The caller (the in-app progress banner, or
 * the daily cron) keeps calling until done. Authorized by either a logged-in
 * staff session (browser) or the CRON_SECRET bearer (cron).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const hasSecret =
    !!secret && request.headers.get("authorization") === `Bearer ${secret}`;

  if (!hasSecret) {
    // Fall back to session auth — must be a signed-in staff member.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new NextResponse("Unauthorized", { status: 401 });
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile || profile.role === "customer") {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  let jobId: string | undefined;
  try {
    ({ jobId } = await request.json());
  } catch {
    /* ignore */
  }
  if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" });

  const result = await processImportJobBatch(jobId);
  return NextResponse.json({ ok: true, ...result });
}

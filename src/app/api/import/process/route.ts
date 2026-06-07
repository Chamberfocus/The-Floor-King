import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import {
  processImportJobBatch,
  triggerImportProcessing,
} from "@/lib/import-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Background worker for import jobs. Processes one batch (within a time budget)
 * and, if work remains, re-triggers itself in a fresh invocation via after().
 * Protected by CRON_SECRET (same as the daily cron).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let jobId: string | undefined;
  try {
    ({ jobId } = await request.json());
  } catch {
    /* ignore */
  }
  if (!jobId) return NextResponse.json({ ok: false, error: "missing jobId" });

  const result = await processImportJobBatch(jobId);

  if (!result.done) {
    // More chunks remain — continue in a new invocation after we respond.
    after(() => triggerImportProcessing(jobId!));
  }

  return NextResponse.json({ ok: true, ...result });
}

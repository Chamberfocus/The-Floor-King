import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/print-button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { loadMorningSheet } from "@/lib/data/morning-sheet";
import { formatDate } from "@/lib/format";
import { shopTodayYmd } from "@/lib/job-snapshot";
import { shopDatePlus } from "@/lib/shop-floor";

export const metadata: Metadata = { title: "Morning sheet" };
export const dynamic = "force-dynamic";

const ROLES = ["admin", "office", "warehouse", "scheduler", "sales_manager"];

export default async function MorningSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await requireProfile();
  if (!ROLES.includes(profile.role)) redirect("/");
  const sp = await searchParams;
  const today = shopTodayYmd();
  const tomorrow = shopDatePlus(today, 1);
  let sheet: Awaited<ReturnType<typeof loadMorningSheet>> | null = null;
  let failed = false;
  try {
    sheet = await loadMorningSheet(sp.date || tomorrow);
  } catch {
    failed = true;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/warehouse" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Warehouse
        </Link>
        <PrintButton label="Print this sheet" />
      </div>
      <PageHeader
        title={sheet ? `Installs for ${formatDate(sheet.date)}` : "Morning sheet"}
        description="Tomorrow's installs, with rolls in bin order. One print for the warehouse and the crew."
      />
      {sheet ? (
        <div className="mb-4 flex flex-wrap gap-2 text-sm print:hidden">
          <Link href={`/warehouse/morning?date=${today}`} className="rounded-md border px-3 py-1.5">
            Today
          </Link>
          <Link href={`/warehouse/morning?date=${tomorrow}`} className="rounded-md border px-3 py-1.5">
            Tomorrow
          </Link>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          This sheet is temporarily unavailable.
        </p>
      ) : null}
      {sheet?.overCapacity ? (
        <p role="status" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {sheet.total} installs are booked and {sheet.crews} crew{sheet.crews === 1 ? " is" : "s are"} active. This day is over capacity.
        </p>
      ) : null}
      {sheet && sheet.jobs.length === 0 && !failed ? (
        <p className="rounded-lg border bg-card px-4 py-3 text-sm">No installs on this day.</p>
      ) : null}
      <div className="flex flex-col gap-4">
        {sheet?.jobs.map((job) => (
          <article key={job.id} className="rounded-lg border bg-card px-4 py-3 break-inside-avoid">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                <Link href={`/jobs/${job.id}`} className="hover:underline">
                  {job.customerName}
                </Link>
              </h2>
              <span className="text-sm text-muted-foreground">{job.arrival || "No arrival window"}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {job.title}
              {job.site ? ` · ${job.site}` : ""}
              {job.claim ? " · Claim" : ""}
            </p>
            {job.rolls.length ? (
              <ol className="mt-2 space-y-1 text-sm">
                {job.rolls.map((roll) => (
                  <li key={roll.id}>
                    {roll.location || "No bin"} · {roll.productName}
                    {roll.rollNumber ? ` · roll ${roll.rollNumber}` : ""}
                    {roll.dyeLot ? ` · lot ${roll.dyeLot}` : ""}
                    {` · ${roll.qty} ${roll.unit}`}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No roll is locked to this job yet.</p>
            )}
            {job.rooms.length ? (
              <div className="mt-3 flex flex-wrap gap-3">
                {job.rooms.map((room, index) => {
                  const long = Math.max(room.lengthIn, room.widthIn);
                  const scale = long > 0 ? 72 / long : 1;
                  const w = Math.max(12, room.widthIn * scale);
                  const h = Math.max(12, room.lengthIn * scale);
                  return (
                    <div key={`${room.name}-${index}`} className="text-xs">
                      <div
                        className="border border-foreground/70"
                        style={{ width: w, height: h }}
                      />
                      <div className="mt-1">
                        {room.name} · {Math.round(room.lengthIn)}" × {Math.round(room.widthIn)}"
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {sheet && sheet.total > sheet.jobs.length ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Showing {sheet.jobs.length} of {sheet.total}. Open the jobs list for the rest of the day.
        </p>
      ) : null}
    </div>
  );
}

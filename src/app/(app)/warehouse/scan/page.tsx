import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireProfile } from "@/lib/auth";
import { findRolls } from "@/lib/data/roll-scan";
import { listJobsOnDate } from "@/lib/data/jobs";
import { shopTodayYmd } from "@/lib/job-snapshot";
import { shopDatePlus } from "@/lib/shop-floor";
import { assignRollToJob, shelveRoll } from "@/app/(app)/inventory/actions";

export const metadata: Metadata = { title: "Scan a roll" };
export const dynamic = "force-dynamic";

const ROLES = ["admin", "office", "warehouse", "sales_manager"];

export default async function ScanRollPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const profile = await requireProfile();
  if (!ROLES.includes(profile.role)) redirect("/");
  const code = (await searchParams).code?.trim() ?? "";
  const found = code ? await findRolls(code) : [];
  const today = shopTodayYmd();
  const [todayJobs, tomorrowJobs] = await Promise.all([
    listJobsOnDate({ date: today }).catch(() => null),
    listJobsOnDate({ date: shopDatePlus(today, 1) }).catch(() => null),
  ]);
  const jobs = [...(todayJobs?.rows ?? []), ...(tomorrowJobs?.rows ?? [])];
  const seen = new Set<string>();
  const choices = jobs.filter((job) => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/warehouse" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Warehouse
        </Link>
        <Link href="/warehouse/tags" className="text-sm font-medium text-primary hover:underline">
          Print roll tags
        </Link>
      </div>
      <PageHeader
        title="Scan a roll"
        description="Scan the tag or type the roll number. Then put it in a bin or lock it to a job."
      />
      <form action="/warehouse/scan" className="mb-4 flex flex-wrap gap-2">
        <Input name="code" defaultValue={code} autoFocus placeholder="Roll number or tag" className="max-w-sm" />
        <Button type="submit">Find</Button>
      </form>
      {code && found.length === 0 ? (
        <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
          No roll matches {code}.
        </p>
      ) : null}
      <div className="flex flex-col gap-4">
        {found.map((roll) => (
          <section key={roll.id} className="rounded-lg border bg-card px-4 py-3">
            <h2 className="font-semibold">{roll.productName}</h2>
            <p className="text-sm text-muted-foreground">
              {roll.rollNumber ? `Roll ${roll.rollNumber}` : "No roll number"}
              {roll.dyeLot ? ` · lot ${roll.dyeLot}` : ""}
              {` · ${roll.qty} ${roll.unit}`}
              {` · ${roll.location || "no bin"}`}
              {` · ${roll.status}`}
            </p>
            <form action={shelveRoll} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="roll_id" value={roll.id} />
              <label className="text-sm">
                Bin
                <Input name="location" defaultValue={roll.location ?? ""} className="mt-1 w-40" />
              </label>
              <Button type="submit" variant="outline" size="sm">
                Save bin
              </Button>
            </form>
            {choices.length ? (
              <form action={assignRollToJob} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="roll_id" value={roll.id} />
                <label className="text-sm">
                  Lock to job
                  <select name="job_id" className="mt-1 h-9 rounded-md border bg-background px-2 text-sm" defaultValue="">
                    <option value="" disabled>
                      Choose an install
                    </option>
                    {choices.map((job) => (
                      <option key={job.id} value={job.id}>
                        {(job.customer_name || job.title || "Install").slice(0, 60)}
                        {job.scheduled_date ? ` · ${job.scheduled_date}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" size="sm">
                  Lock this roll
                </Button>
              </form>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No install is booked today or tomorrow to lock this roll to.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

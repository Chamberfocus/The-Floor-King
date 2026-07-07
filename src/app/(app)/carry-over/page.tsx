import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listAssignableUsers } from "@/lib/data/jobs";
import { CarryOverForm } from "./carry-over-form";

export const metadata: Metadata = { title: "Carry over work" };
export const dynamic = "force-dynamic";

export default async function CarryOverPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name")
    .order("full_name", { ascending: true })
    .limit(2000);
  const customers = (data ?? []).map((c) => ({
    id: c.id as string,
    full_name: (c.full_name as string) ?? "Unnamed",
  }));
  const assignable = await listAssignableUsers();
  const installers = assignable
    .filter((u) => u.role === "crew")
    .map((u) => ({ id: u.id, name: u.name }));
  const salespeople = assignable
    .filter((u) => u.role === "salesman" || u.role === "sales_manager")
    .map((u) => ({ id: u.id, name: u.name }));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Carry over work in progress"
        description="Bring your live deals over from the old system at their current state — one at a time, no line items to re-enter. Each one becomes a real estimate or job so your pipeline, schedule, balances and Business Pulse all read true from day one."
      />
      <div className="mb-4 rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">How to use this</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium text-foreground">Open estimate</span> —
            a quote that&apos;s still out, waiting on a yes/no. Lands in your
            pipeline.
          </li>
          <li>
            <span className="font-medium text-foreground">Sold install</span> — a
            job that&apos;s sold but not finished. Records the deposit you already
            took and the balance still owed, and drops it on the job board.
          </li>
          <li>
            Only enter <span className="font-medium text-foreground">live</span>{" "}
            work. Finished jobs and old leads stay in the old system — no need to
            recreate history.
          </li>
        </ul>
      </div>
      <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
        Already sold and just need it installed?{" "}
        <a href="/jobs/quick" className="font-medium text-primary underline-offset-2 hover:underline">
          Use Quick install
        </a>{" "}
        — no pricing or invoicing, straight to the schedule.
      </div>
      <CarryOverForm
        customers={customers}
        installers={installers}
        salespeople={salespeople}
      />
    </div>
  );
}

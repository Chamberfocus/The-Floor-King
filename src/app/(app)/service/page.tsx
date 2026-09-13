import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth";
import { listOpenServiceCallbacks } from "@/lib/data/ops-glue";
import {
  resolveServiceCallback,
} from "@/app/(app)/ops/actions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Service / callbacks" };
export const dynamic = "force-dynamic";

export default async function ServicePage() {
  const profile = await requireProfile();
  if (
    !["admin", "office", "sales_manager", "salesman", "scheduler"].includes(
      profile.role,
    )
  ) {
    redirect("/");
  }
  const rows = await listOpenServiceCallbacks();

  return (
    <div>
      <PageHeader
        title="Service / callbacks"
        description="Open punch-list, warranty, and return-trip issues. Resolve them here so jobs don't stall."
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No open service issues"
          description="When a crew reports a problem or office logs a callback, it shows up here."
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  href={r.job_id ? `/jobs/${r.job_id}` : `/customers/${r.customer_id}`}
                  className="font-medium hover:underline"
                >
                  {r.customer_name || "Customer"}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {r.category.replace(/_/g, " ")} · {r.status}
                  {r.follow_up_at ? ` · follow up ${formatDate(r.follow_up_at)}` : ""}
                </div>
                {r.description ? (
                  <p className="mt-1 text-sm">{r.description}</p>
                ) : null}
              </div>
              <form action={resolveServiceCallback} className="flex shrink-0 flex-col gap-2 sm:w-64">
                <input type="hidden" name="callback_id" value={r.id} />
                <input type="hidden" name="job_id" value={r.job_id ?? ""} />
                <input type="hidden" name="customer_id" value={r.customer_id} />
                <textarea
                  name="resolution_notes"
                  placeholder="How it was resolved"
                  className="min-h-16 rounded-md border px-2 py-1 text-sm"
                />
                <Button type="submit" size="sm" variant="outline" className="min-h-10">
                  Resolve
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

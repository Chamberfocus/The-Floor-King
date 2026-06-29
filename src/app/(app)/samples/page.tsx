import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, Check, Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireProfile } from "@/lib/auth";
import { listOutstandingCheckouts } from "@/lib/data/samples";
import { returnCheckoutAction } from "@/app/(app)/customers/[id]/sample-actions";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Samples" };
export const dynamic = "force-dynamic";

const ALLOWED = ["admin", "office", "sales_manager", "salesman", "scheduler"];

function daysLeft(due: string): number {
  const a = new Date(new Date().toDateString()).getTime(); // today, local midnight
  const b = new Date(`${due}T00:00:00`).getTime(); // due, local midnight
  return Math.round((b - a) / 86400000);
}

export default async function SamplesPage() {
  const profile = await requireProfile();
  if (!ALLOWED.includes(profile.role)) redirect("/");

  const out = await listOutstandingCheckouts();
  const overdue = out.filter((c) => daysLeft(c.due_date) < 0).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Samples out"
        description="Every sample checked out and not yet returned, soonest-due first. Customers are reminded by text & email automatically."
      >
        {overdue > 0 ? (
          <span className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
            {overdue} overdue
          </span>
        ) : null}
      </PageHeader>

      {out.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing checked out right now. Check out samples from a customer&apos;s
          file when they take some home.
        </p>
      ) : (
        <div className="space-y-2">
          {out.map((c) => {
            const dl = daysLeft(c.due_date);
            const overdueRow = dl < 0;
            return (
              <Card key={c.id}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/customers/${c.customer_id}`}
                      className="font-medium hover:underline"
                    >
                      {c.customer_name ?? "Customer"}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      <Package className="size-3.5" />
                      {c.items
                        .map((i) => `${i.qty > 1 ? `${i.qty}× ` : ""}${i.label}`)
                        .join(", ")}
                    </div>
                    <div
                      className={cn(
                        "mt-1 inline-flex items-center gap-1 text-xs font-medium",
                        overdueRow
                          ? "text-destructive"
                          : dl <= 2
                            ? "text-amber-700"
                            : "text-muted-foreground",
                      )}
                    >
                      <CalendarClock className="size-3" />
                      {overdueRow
                        ? `${Math.abs(dl)} day${Math.abs(dl) === 1 ? "" : "s"} overdue`
                        : dl === 0
                          ? "Due today"
                          : `${dl} day${dl === 1 ? "" : "s"} left`}{" "}
                      · due {formatDate(c.due_date)}
                    </div>
                  </div>
                  <form action={returnCheckoutAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <Button type="submit" size="sm" variant="outline">
                      <Check className="size-3.5" /> Returned
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

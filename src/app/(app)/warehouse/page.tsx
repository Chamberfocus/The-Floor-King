import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MapPin, CalendarDays } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { SegmentedField } from "@/components/ui/segmented-field";
import { requireProfile } from "@/lib/auth";
import { listWarehouseJobs } from "@/lib/data/jobs";
import {
  JOB_DELIVERY_LABELS,
  WAREHOUSE_STATUS_LABELS,
  WAREHOUSE_STATUS_ORDER,
  type JobDeliveryType,
} from "@/lib/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  setWarehouseStatus,
  setDeliveryType,
  reportMaterialIssue,
} from "../jobs/actions";

export const metadata: Metadata = { title: "Warehouse" };

const DELIVERY_BANNER: Record<JobDeliveryType, string> = {
  cash_carry: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  deliver: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  deliver_acclimate:
    "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
};

// Steps shown as buttons (skip "pending" — that's the starting state).
const STEPS = WAREHOUSE_STATUS_ORDER.filter((s) => s !== "pending");

const fieldClass =
  "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default async function WarehousePage() {
  const profile = await requireProfile();
  if (
    profile.role !== "warehouse" &&
    profile.role !== "admin" &&
    profile.role !== "office"
  ) {
    redirect("/");
  }

  const jobs = await listWarehouseJobs();

  return (
    <div>
      <PageHeader
        title="Warehouse"
        description="Materials to prep, stage, and deliver for upcoming jobs."
      />

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No active jobs need materials right now.
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((j) => {
            const site = [j.site_street, j.site_city, j.site_state]
              .filter(Boolean)
              .join(", ");
            return (
              <Card key={j.id}>
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {j.customer_name ?? "Customer"}
                      {j.title ? ` — ${j.title}` : ""}
                    </CardTitle>
                    <span
                      className={cn(
                        "rounded-md px-2.5 py-1 text-sm font-semibold",
                        DELIVERY_BANNER[j.delivery_type],
                      )}
                    >
                      {JOB_DELIVERY_LABELS[j.delivery_type]}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-4" />
                      {j.scheduled_date
                        ? formatDate(j.scheduled_date)
                        : "Not scheduled"}
                    </span>
                    {site ? (
                      <span className="flex items-center gap-1.5">
                        <MapPin className="size-4" />
                        {site}
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Materials */}
                  <div>
                    <div className="mb-1 text-sm font-medium">Materials</div>
                    {j.materials.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No material list linked to this job.
                      </p>
                    ) : (
                      <ul className="text-sm">
                        {j.materials.map((m, i) => (
                          <li key={i} className="flex justify-between py-0.5">
                            <span>
                              {m.room ? `${m.room} — ` : ""}
                              {m.description || "Material"}
                            </span>
                            <span className="text-muted-foreground">
                              {m.sqft ? `${m.sqft} sq ft` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Staging status */}
                  <div>
                    <div className="mb-2 text-sm font-medium">
                      Status: {WAREHOUSE_STATUS_LABELS[j.warehouse_status]}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {STEPS.map((s) => {
                        const current = j.warehouse_status === s;
                        return (
                          <form key={s} action={setWarehouseStatus}>
                            <input type="hidden" name="id" value={j.id} />
                            <input
                              type="hidden"
                              name="warehouse_status"
                              value={s}
                            />
                            <Button
                              type="submit"
                              size="lg"
                              variant={current ? "default" : "outline"}
                            >
                              {WAREHOUSE_STATUS_LABELS[s]}
                            </Button>
                          </form>
                        );
                      })}
                    </div>
                  </div>

                  {/* Delivery type override */}
                  <form
                    action={setDeliveryType}
                    className="flex items-center gap-2 border-t pt-3"
                  >
                    <input type="hidden" name="id" value={j.id} />
                    <span className="text-sm text-muted-foreground">
                      Delivery:
                    </span>
                    <SegmentedField
                      size="sm"
                      name="delivery_type"
                      defaultValue={j.delivery_type}
                      options={(Object.keys(JOB_DELIVERY_LABELS) as JobDeliveryType[]).map(
                        (d) => ({ value: d, label: JOB_DELIVERY_LABELS[d] }),
                      )}
                    />
                    <Button type="submit" variant="outline" size="sm">
                      Update
                    </Button>
                  </form>

                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Report a problem (missing / short / wrong item)
                    </summary>
                    <form
                      action={reportMaterialIssue}
                      className="mt-2 flex flex-wrap gap-2"
                    >
                      <input type="hidden" name="id" value={j.id} />
                      <input
                        name="note"
                        required
                        placeholder="What's missing or wrong?"
                        className={cn(fieldClass, "flex-1")}
                      />
                      <Button type="submit" variant="destructive" size="sm">
                        Alert the team
                      </Button>
                    </form>
                  </details>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

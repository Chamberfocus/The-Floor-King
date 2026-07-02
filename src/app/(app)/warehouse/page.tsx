import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MapPin, CalendarDays, HardHat } from "lucide-react";
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
import { listOrders } from "@/lib/data/orders";
import { reportOrderStock } from "../orders/actions";
import {
  JOB_DELIVERY_LABELS,
  WAREHOUSE_STATUS_LABELS,
  WAREHOUSE_STATUS_ORDER,
  ORDER_STOCK_LABELS,
  type JobDeliveryType,
} from "@/lib/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  setWarehouseStatus,
  setDeliveryType,
  reportMaterialIssue,
} from "../jobs/actions";
import { WarehouseJobActions } from "./warehouse-job-actions";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { getOrgSettings } from "@/lib/data/org";
import { StagingSheetDoc } from "./staging-sheet-doc";
import { WarehousePrintProvider, PrintStagingButton } from "./warehouse-print";

export const metadata: Metadata = { title: "Warehouse" };

const DELIVERY_BANNER: Record<JobDeliveryType, string> = {
  cash_carry: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  deliver: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  installer_pickup:
    "bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200",
  deliver_acclimate:
    "bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200",
};

// Post-staging delivery steps (accept → staged is handled by the lifecycle
// component; these track getting it out the door).
const DELIVERY_STEPS = WAREHOUSE_STATUS_ORDER.filter(
  (s) => s !== "pending" && s !== "staged",
);

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
  const org = await getOrgSettings();
  const stockChecks = (await listOrders()).filter(
    (o) => o.status === "submitted",
  );

  // One print-ready staging sheet per job (hidden until its button is clicked).
  const sheets = jobs.map((j) => ({
    id: j.id,
    node: <StagingSheetDoc org={org} job={j} />,
  }));

  return (
    <WarehousePrintProvider sheets={sheets}>
      <RealtimeRefresh table="jobs" />
      <RealtimeRefresh table="orders" />
      <PageHeader
        title="Warehouse"
        description="Materials to prep, stage, and deliver for upcoming jobs."
      />

      {/* New client orders — flag stock right away so the office can decide */}
      {stockChecks.length > 0 ? (
        <div className="mb-6 space-y-2">
          <h2 className="text-sm font-semibold">
            Stock checks — new orders ({stockChecks.length})
          </h2>
          {stockChecks.map((o) => (
            <Card key={o.id} className="border-blue-300 dark:border-blue-900/60">
              <CardContent className="space-y-2 py-3">
                <div className="text-sm font-medium">
                  {o.contact_name || "Order"}
                  {o.contact_phone ? (
                    <span className="ml-1 font-normal text-muted-foreground">
                      · {o.contact_phone}
                    </span>
                  ) : null}
                </div>
                <ul className="text-sm">
                  {(o.items ?? []).map((it) => (
                    <li key={it.id}>
                      •{" "}
                      {[it.description, it.color, it.style]
                        .filter(Boolean)
                        .join(" · ") || "Item"}
                      {it.quantity ? ` — ${it.quantity} ${it.unit}` : ""}
                      {it.cut_notes ? (
                        <span className="text-muted-foreground">
                          {" "}
                          (cuts: {it.cut_notes.split(" | ").join(", ")})
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <form
                  action={reportOrderStock}
                  className="flex flex-wrap items-center gap-2 border-t pt-2"
                >
                  <input type="hidden" name="order_id" value={o.id} />
                  <input
                    name="stock_note"
                    placeholder="Note (optional) — e.g. have beige, gray backordered"
                    className="h-9 min-w-48 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                  />
                  <button
                    name="stock_status"
                    value="in_stock"
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    In stock ✓
                  </button>
                  <button
                    name="stock_status"
                    value="partial"
                    className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Partial
                  </button>
                  <button
                    name="stock_status"
                    value="out_of_stock"
                    className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Out ✗
                  </button>
                </form>
                {o.stock_status !== "unknown" ? (
                  <p className="text-xs text-muted-foreground">
                    Reported: {ORDER_STOCK_LABELS[o.stock_status]}
                    {o.stock_note ? ` — ${o.stock_note}` : ""}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

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
            const timeframe = j.scheduled_date
              ? j.scheduled_end && j.scheduled_end !== j.scheduled_date
                ? `${formatDate(j.scheduled_date)} – ${formatDate(j.scheduled_end)}`
                : formatDate(j.scheduled_date)
              : "Not scheduled";
            return (
              <Card key={j.id}>
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {j.customer_name ?? "Customer"}
                      {j.title ? ` — ${j.title}` : ""}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <PrintStagingButton id={j.id} />
                      <span
                        className={cn(
                          "rounded-md px-2.5 py-1 text-sm font-semibold",
                          DELIVERY_BANNER[j.delivery_type],
                        )}
                      >
                        {JOB_DELIVERY_LABELS[j.delivery_type]}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-4" />
                      {timeframe}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <HardHat className="size-4" />
                      {j.crew_name ?? "Installer not assigned"}
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
                              {m.quantity && m.quantity > 0
                                ? `${Math.round(m.quantity * 100) / 100} ${m.unit || ""}`.trim()
                                : m.sqft
                                  ? `${m.sqft} sq ft`
                                  : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Staging / crew notes (e.g. carry-over "what to stage") */}
                  {j.notes ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                      <div className="mb-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        Staging notes
                      </div>
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {j.notes}
                      </p>
                    </div>
                  ) : null}

                  {/* Warehouse lifecycle: accept (with acknowledgment) → staged */}
                  <div>
                    {j.warehouse_assignee_name ? (
                      <div className="mb-1.5 text-xs text-muted-foreground">
                        Warehouse: {j.warehouse_assignee_name}
                      </div>
                    ) : null}
                    <WarehouseJobActions
                      job={{
                        id: j.id,
                        warehouse_submitted_at: j.warehouse_submitted_at,
                        warehouse_accepted_at: j.warehouse_accepted_at,
                        warehouse_ready_at: j.warehouse_ready_at,
                        staging_location: j.staging_location,
                        warehouse_assignee_name: j.warehouse_assignee_name,
                      }}
                    />
                  </div>

                  {/* Delivery progress — only once it's staged & ready */}
                  {j.warehouse_ready_at ? (
                    <div>
                      <div className="mb-2 text-sm font-medium">
                        Delivery: {WAREHOUSE_STATUS_LABELS[j.warehouse_status]}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {DELIVERY_STEPS.map((s) => {
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
                  ) : null}

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
    </WarehousePrintProvider>
  );
}

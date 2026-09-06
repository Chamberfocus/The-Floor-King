import Link from "next/link";
import { PackageCheck, ShoppingCart, Boxes, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { cn } from "@/lib/utils";
import type { JobMaterials, JobMaterialLine } from "@/lib/data/job-materials";
import {
  prepareJobMaterials,
  setLineSource,
  pullJobLine,
  pullAllStock,
} from "../material-actions";

/** Inches → feet'inches" (e.g. 150 → 12'6"). */
function ftIn(inches: number): string {
  if (!Number.isFinite(inches) || inches <= 0) return "";
  const ft = Math.floor(inches / 12);
  const inch = Math.round(inches % 12);
  return inch > 0 ? `${ft}'${inch}"` : `${ft}'`;
}

function StatusBadge({ line }: { line: JobMaterialLine }) {
  const map: Record<JobMaterialLine["status"], { label: string; cls: string }> = {
    order: { label: "Special order", cls: "bg-sky-500/10 text-sky-600" },
    partial: { label: "Partially arrived", cls: "bg-amber-500/10 text-amber-700" },
    arrived: { label: "Arrived ✓", cls: "bg-emerald-500/10 text-emerald-600" },
    short: { label: "Not enough stock", cls: "bg-destructive/10 text-destructive" },
    to_reserve: { label: "From stock", cls: "bg-violet-500/10 text-violet-600" },
    reserved: { label: "Reserved", cls: "bg-amber-500/10 text-amber-600" },
    pulled: { label: "Pulled ✓", cls: "bg-emerald-500/10 text-emerald-600" },
  };
  const s = map[line.status];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", s.cls)}>
      {s.label}
    </span>
  );
}

export function JobMaterialsCard({ data }: { data: JobMaterials }) {
  if (!data.lines.length) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="size-4" /> Materials &amp; sourcing
        </CardTitle>
        <div className="flex gap-2">
          <form action={prepareJobMaterials}>
            <input type="hidden" name="job_id" value={data.jobId} />
            <ConfirmButton
              variant="outline"
              size="sm"
              title="Prepare materials for this job?"
              description="Reserves in-stock items and builds a purchase order for the special-order items."
              confirmLabel="Prepare materials"
            >
              <PackageCheck className="size-4" /> Prepare materials
            </ConfirmButton>
          </form>
          {data.hasStock ? (
            <form action={pullAllStock}>
              <input type="hidden" name="job_id" value={data.jobId} />
              <ConfirmButton
                size="sm"
                title="Pull all stock for this job?"
                description="Pulls every in-stock line from inventory — this decrements on-hand stock and lands the cost on this job. Do this when you actually stage it."
                confirmLabel="Pull stock"
              >
                Pull all stock
              </ConfirmButton>
            </form>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          &ldquo;Prepare&rdquo; reserves in-stock items and builds a PO for
          special-order items. Pull stock when you stage the job — its cost lands
          on this job&apos;s profit.
        </p>
        {data.legacyPoReviewRequired ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="font-semibold">Review required:</span> legacy purchase
            orders from before job-line linking may cover this material, but the
            link is ambiguous. Auto-ordering is paused until staff confirms PO
            coverage on the Purchasing tab.
          </p>
        ) : null}
        <div className="divide-y rounded-md border">
          {data.lines.map((l) => (
            <div
              key={l.lineId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {l.productName || l.description || "Material"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {l.room ? `${l.room} · ` : ""}
                  {l.qty} {l.unit}
                  {l.widthIn && l.lengthIn
                    ? ` · cut ${ftIn(l.widthIn)} × ${ftIn(l.lengthIn)}`
                    : ""}
                  {l.trackStock
                    ? ` · ${l.onHand} on hand${
                        l.available !== l.onHand ? ` (${l.available} free)` : ""
                      }`
                    : " · not stocked"}
                </div>
                {l.resolvedSource === "order" && l.supplier ? (
                  <div className="text-xs font-medium text-sky-600">
                    Order from {l.supplier}
                  </div>
                ) : null}
                {l.resolvedSource === "order" && l.purchasingGap > 0.001 ? (
                  <div className="text-xs text-amber-700">
                    Purchasing gap: {l.purchasingGap} {l.unit} still uncovered
                  </div>
                ) : null}
                {l.resolvedSource === "order" && l.excessIssued > 0.001 ? (
                  <div className="flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3" />
                    Excess on issued PO: {l.excessIssued} {l.unit} (not auto-reduced)
                  </div>
                ) : null}
                {l.resolvedSource === "order" && l.arrivedQty > 0 && l.status !== "arrived" ? (
                  <div className="text-xs text-muted-foreground">
                    Arrived {l.arrivedQty} of {l.qty} {l.unit}
                  </div>
                ) : null}
              </div>

              <StatusBadge line={l} />

              {/* Source switch */}
              {l.resolvedSource === "order" && l.trackStock ? (
                <form action={setLineSource}>
                  <input type="hidden" name="job_id" value={data.jobId} />
                  <input type="hidden" name="line_id" value={l.lineId} />
                  <input type="hidden" name="source" value="stock" />
                  <SubmitButton variant="ghost" size="sm" confirm="Set to stock">
                    <Boxes className="size-4" /> Use stock
                  </SubmitButton>
                </form>
              ) : null}
              {l.resolvedSource === "stock" ? (
                <form action={setLineSource}>
                  <input type="hidden" name="job_id" value={data.jobId} />
                  <input type="hidden" name="line_id" value={l.lineId} />
                  <input type="hidden" name="source" value="order" />
                  <SubmitButton variant="ghost" size="sm" confirm="Set to order">
                    <ShoppingCart className="size-4" /> Order instead
                  </SubmitButton>
                </form>
              ) : null}

              {/* Pull (stock lines not fully pulled) */}
              {l.resolvedSource === "stock" &&
              l.pulledQty < l.qty - 0.001 &&
              l.onHand > 0 ? (
                <form action={pullJobLine}>
                  <input type="hidden" name="job_id" value={data.jobId} />
                  <input type="hidden" name="line_id" value={l.lineId} />
                  <ConfirmButton
                    size="sm"
                    variant="outline"
                    title={`Pull ${l.productName || l.description || "this material"} from stock?`}
                    description="Decrements on-hand inventory for this line and lands its cost on the job."
                    confirmLabel="Pull stock"
                  >
                    Pull
                  </ConfirmButton>
                </form>
              ) : null}
            </div>
          ))}
        </div>

        {data.hasOrder ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="size-3.5 text-amber-600" />
            Special-order items go on a purchase order.{" "}
            <Link href="/purchase-orders" className="font-medium hover:underline">
              View POs
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

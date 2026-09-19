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
import { hardSurfaceAreaCartonCount } from "@/lib/estimate-calc";
import { padRollCount } from "@/lib/job-scope";
import { computeMaterialTakeoff } from "@/lib/flooring-knowledge";
import { normalizeUnit } from "@/lib/units";
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

function cartonLineOf(l: JobMaterialLine) {
  return {
    description: l.description || l.productName,
    category: l.category,
    unit: l.unit,
    sqft: l.sqftArea,
    quantity: l.qty,
    sqft_per_box: l.sqftPerBox,
    roll_width_ft: l.rollWidthFt,
    order_as_roll: l.orderAsRoll,
    length_in: l.lengthIn,
    width_in: l.widthIn,
    measurements: l.measurements,
  };
}

function cartonCountFor(l: JobMaterialLine): number {
  // Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
  // Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.
  return hardSurfaceAreaCartonCount(cartonLineOf(l), l.qty);
}

function cartonCountForQty(l: JobMaterialLine, billedQty: number): number {
  // Exclusive carpet-tile job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
  // Hard-surface job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage.
  return hardSurfaceAreaCartonCount(cartonLineOf(l), billedQty);
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
          {data.lines.map((l) => {
            const cartons = cartonCountFor(l);
            const gapCartons = cartonCountForQty(l, l.purchasingGap);
            const excessCartons = cartonCountForQty(l, l.excessIssued);
            const arrivedCartons = cartonCountForQty(l, l.arrivedQty);
            const remaining = Math.max(l.qty - l.arrivedQty, 0);
            // Exclusive carpet-tile job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Hard-surface job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage.
            const outstandingCartons = cartonCountForQty(l, remaining);
            const unitKey = normalizeUnit(l.unit);
            // Exclusive carpet-tile job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Hard-surface job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage.
            const jobMaterialsPadTakeoff =
              l.category === "underlayment" && l.unit !== "sheet"
                ? computeMaterialTakeoff({
                    family: "other",
                    measuredSqft: Number(l.sqftArea) || 0,
                    wastePct: l.wastePct,
                    sqftPerBox: Number(l.sqftPerBox) > 0 ? Number(l.sqftPerBox) : null,
                    billingUnit: unitKey === "sqyd" ? "sqyd" : "sqft",
                    takeoffLabel: "Carpet pad",
                  })
                : null;
            // Exclusive carpet-tile job materials order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Underlayment job materials order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll.
            const padRolls = padRollCount(l.category, l.qty, unitKey);
            // Exclusive carpet-tile job materials purchasing-gap order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Underlayment job materials purchasing-gap order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll.
            const gapPadRolls = padRollCount(l.category, l.purchasingGap, unitKey);
            // Exclusive carpet-tile job materials excess order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Underlayment job materials excess order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll.
            const excessPadRolls = padRollCount(l.category, l.excessIssued, unitKey);
            // Exclusive carpet-tile job materials arrived order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Underlayment job materials arrived order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll.
            const arrivedPadRolls = padRollCount(l.category, l.arrivedQty, unitKey);
            // Exclusive carpet-tile job materials outstanding order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
            // Underlayment job materials outstanding order pad-roll count from remaining order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll.
            const outstandingPadRolls = padRollCount(l.category, remaining, unitKey);
            return (
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
                  {/* Exclusive carpet-tile job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                  {/* Hard-surface job materials carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. */}
                  {cartons
                    ? ` · 📦 ${cartons} carton${cartons === 1 ? "" : "s"}`
                    : ""}
                  {/* Exclusive carpet-tile job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                  {/* Hard-surface job materials pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. */}
                  {jobMaterialsPadTakeoff?.cartons
                    ? ` · 📦 ${jobMaterialsPadTakeoff.cartons.cartonCount} carton${jobMaterialsPadTakeoff.cartons.cartonCount === 1 ? "" : "s"}`
                    : ""}
                  {/* Exclusive carpet-tile job materials order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                  {/* Underlayment job materials order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. */}
                  {padRolls
                    ? ` · ${padRolls} roll${padRolls === 1 ? "" : "s"}`
                    : ""}
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
                    {/* Exclusive carpet-tile job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Hard-surface job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. */}
                    {gapCartons
                      ? ` · 📦 ${gapCartons} carton${gapCartons === 1 ? "" : "s"}`
                      : ""}
                    {/* Exclusive carpet-tile job materials purchasing-gap order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Underlayment job materials purchasing-gap order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. */}
                    {gapPadRolls
                      ? ` · ${gapPadRolls} roll${gapPadRolls === 1 ? "" : "s"}`
                      : ""}
                  </div>
                ) : null}
                {l.resolvedSource === "order" && l.excessIssued > 0.001 ? (
                  <div className="flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="size-3" />
                    Excess on issued PO: {l.excessIssued} {l.unit} (not auto-reduced)
                    {/* Exclusive carpet-tile job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Hard-surface job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. */}
                    {excessCartons
                      ? ` · 📦 ${excessCartons} carton${excessCartons === 1 ? "" : "s"}`
                      : ""}
                    {/* Exclusive carpet-tile job materials excess order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Underlayment job materials excess order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. */}
                    {excessPadRolls
                      ? ` · ${excessPadRolls} roll${excessPadRolls === 1 ? "" : "s"}`
                      : ""}
                  </div>
                ) : null}
                {l.resolvedSource === "order" && l.arrivedQty > 0 && l.status !== "arrived" ? (
                  <div className="text-xs text-muted-foreground">
                    Arrived {l.arrivedQty} of {l.qty} {l.unit}
                    {/* Exclusive carpet-tile job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Hard-surface job materials purchasing-gap carton count from sq ft ÷ coverage is the pull, not leftover taped sq ft. Wrap / count How many stays off carton math. Do not invent coverage. */}
                    {arrivedCartons || cartons
                      ? ` · 📦 ${arrivedCartons} of ${cartons} carton${cartons === 1 ? "" : "s"}`
                      : ""}
                    {/* Exclusive carpet-tile job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Hard-surface job materials outstanding order carton count from remaining order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage. */}
                    {outstandingCartons
                      ? ` · 📦 ${outstandingCartons} carton${outstandingCartons === 1 ? "" : "s"} still outstanding`
                      : ""}
                    {/* Exclusive carpet-tile job materials arrived order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Underlayment job materials arrived order pad-roll count from order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. */}
                    {arrivedPadRolls
                      ? ` · ${arrivedPadRolls} roll${arrivedPadRolls === 1 ? "" : "s"}`
                      : ""}
                    {/* Exclusive carpet-tile job materials outstanding order pad-roll count stays off 30-yard roll math — mixed stretch-in + tile and unanswered carpet stay open. Sq-ft underlayment stays off 30-yard roll math. Do not invent a 30-yard roll. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box. */}
                    {/* Underlayment job materials outstanding order pad-roll count from remaining order qty ÷ 30-yard roll is the pull, not leftover measured sq yd. Wrap / count How many stays off 30-yard roll math. Do not invent a 30-yard roll. */}
                    {outstandingPadRolls
                      ? ` · ${outstandingPadRolls} roll${outstandingPadRolls === 1 ? "" : "s"} still outstanding`
                      : ""}
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
            );
          })}
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

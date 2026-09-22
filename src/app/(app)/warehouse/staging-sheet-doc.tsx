import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate } from "@/lib/format";
import {
  JOB_DELIVERY_LABELS,
  isRollGoodCategory,
  isHardSurfaceCategory,
  type OrgSettings,
} from "@/lib/types";
import { stripRoomFromName, PAD_ROLL_SQYD, padRollCount, type CutSource } from "@/lib/job-scope";
import { hardSurfaceAreaCartonCount, lineSkipsAreaCartonMath, lineUsesAreaCartonMath } from "@/lib/estimate-calc";
import { computeMaterialTakeoff } from "@/lib/flooring-knowledge";
import { billedQtyToSqft, normalizeUnit } from "@/lib/units";
import { CarpetCutList } from "@/components/carpet-cut-list";
import type { WarehouseJob } from "@/lib/data/jobs";
import type { JobMaterialLine } from "@/lib/data/job-materials";

/**
 * Print-only WAREHOUSE STAGING SHEET — the warehouse's job-prep doc. It has two
 * parts: (1) a PRODUCT SUMMARY — one line per product with its total quantity to
 * pull, combining the same product used across rooms (a what-to-get list, not a
 * room-by-room list); and (2) the CARPET CUT PLAN — the exact per-piece cuts the
 * warehouse must make off the roll (this stays piece-by-piece; it has to be
 * accurate to cut correctly). Plus staging notes and a "staged by" sign-off.
 * Everything comes from the SAME sourced list the on-screen warehouse queue uses
 * (getJobMaterials), so the printout can't disagree with the screen. The
 * installer-facing doc is the separate INSTALLATION WORK ORDER.
 */
export function StagingSheetDoc({
  org,
  job,
  lines,
  shopNotes = [],
}: {
  shopNotes?: { body: string; authorName: string }[];
  org: OrgSettings;
  job: WarehouseJob;
  lines: JobMaterialLine[];
}) {
  const site = [
    job.site_street,
    [job.site_city, job.site_state].filter(Boolean).join(", "),
    job.site_zip,
  ]
    .filter(Boolean)
    .join(" · ");

  const timeframe = job.scheduled_date
    ? job.scheduled_end && job.scheduled_end !== job.scheduled_date
      ? `${formatDate(job.scheduled_date)} – ${formatDate(job.scheduled_end)}`
      : formatDate(job.scheduled_date)
    : "Not scheduled";

  const facts: [string, string | null][] = [
    ["Installer / crew", job.crew_name],
    ["Delivery", JOB_DELIVERY_LABELS[job.delivery_type]],
    ["Warehouse", job.warehouse_assignee_name],
    ["Staged at", job.staging_location ?? null],
  ];

  // Product summary: combine the same product across rooms into ONE line with a
  // single total quantity (fill pieces roll into their product too). Identity is
  // the catalog product_id when the line has one — so the same product used in
  // several rooms collapses even if a per-line label (e.g. manufacturer) drifted;
  // lines with no product fall back to their (room-stripped) name. Only the pull
  // action (stock vs order, arrived vs not) splits a product into separate rows,
  // since that changes what the warehouse actually does.
  interface ProductGroup {
    key: string;
    category: string | null;
    name: string;
    unit: string;
    sqftPerBox: number | null;
    rollWidthFt: number | null;
    orderAsRoll: boolean;
    resolvedSource: JobMaterialLine["resolvedSource"];
    status: JobMaterialLine["status"];
    qty: number;
    sqftArea: number;
    wastePct: number | null;
    // Label votes: a mis-tagged line (wrong manufacturer/supplier on one room)
    // shouldn't win the printed label — the majority value shows.
    mfrVotes: Map<string, number>;
    colorVotes: Map<string, number>;
    supplierVotes: Map<string, number>;
  }
  const bumpVote = (map: Map<string, number>, v: string | null) => {
    if (v) map.set(v, (map.get(v) ?? 0) + 1);
  };
  const topVote = (map: Map<string, number>): string | null => {
    let best: string | null = null;
    let n = 0;
    for (const [k, c] of map)
      if (c > n) {
        best = k;
        n = c;
      }
    return best;
  };
  const groups: ProductGroup[] = [];
  const byKey = new Map<string, ProductGroup>();
  for (const m of lines) {
    // Show what's actually on the ESTIMATE (the line description) — not the
    // linked catalog product's name, which can be wrong if a product was picked
    // on a line by mistake (e.g. a "Tear-out" line linked to a staples product
    // showed as "Staples"). Drop the room baked onto the description so the same
    // item across rooms collapses to one line.
    const name = stripRoomFromName(m.description || m.productName || "Material", m.room);
    const identity = m.productId ?? name.toLowerCase();
    const key = [
      identity,
      m.unit ?? "",
      m.sqftPerBox ?? "",
      m.rollWidthFt ?? "",
      m.orderAsRoll ? "1" : "0",
      m.resolvedSource,
      m.status,
    ].join("|");
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        category: m.category,
        name,
        unit: m.unit,
        sqftPerBox: m.sqftPerBox,
        rollWidthFt: m.rollWidthFt,
        orderAsRoll: m.orderAsRoll,
        resolvedSource: m.resolvedSource,
        status: m.status,
        qty: 0,
        sqftArea: 0,
        wastePct: m.wastePct,
        mfrVotes: new Map(),
        colorVotes: new Map(),
        supplierVotes: new Map(),
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.qty += m.qty;
    g.sqftArea += Number(m.sqftArea) || 0;
    bumpVote(g.mfrVotes, m.manufacturer);
    bumpVote(g.colorVotes, m.color);
    bumpVote(g.supplierVotes, m.supplier);
  }

  return (
    <div className="text-black">
      <PrintLetterhead
        org={org}
        docTitle="STAGING SHEET"
        meta={
          <>
            <div className="text-sm font-medium">
              {job.customer_name ?? "Customer"}
            </div>
            {job.title ? <div className="text-xs">{job.title}</div> : null}
            <div className="text-xs">Scheduled {timeframe}</div>
          </>
        }
      />

      {site ? (
        <div className="py-3 text-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Job site:{" "}
          </span>
          <span>{site}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-10 gap-y-1 border-y py-2 text-sm">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                {k}:{" "}
              </span>
              <span>{v}</span>
            </div>
          ))}
      </div>

      {/* Products needed — one line per product, tick each as it's pulled */}
      <div className="mt-4">
        <div className="mb-1 text-sm font-semibold">Products needed for this job</div>
        {groups.length ? (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] text-gray-500">
                <th className="w-8 py-1 pr-2 font-medium">Done</th>
                <th className="py-1 px-2 font-medium">Product</th>
                <th className="py-1 px-2 font-medium">Source</th>
                <th className="py-1 pl-2 text-right font-medium">Total quantity</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const isRoll = isRollGoodCategory(g.category);
                // Padding = underlayment sold by the sq yd → tell the warehouse
                // how many ROLLS to pull (standard PAD_ROLL_SQYD per roll).
                // Use the canonical unit key — never parse "yd" out of a label.
                const unitKey = normalizeUnit(g.unit);
                // Exclusive carpet-tile staging pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft — mixed stretch-in + tile and unanswered carpet stay cuts. Wrap / count How many stays off carton math. Do not invent coverage. Do not invent a carpet-tile category. Do not infer exclusive tile from unit=box.
                // Hard-surface staging pad takeoff order carton count from order qty ÷ coverage is the pull, not leftover measured sq ft. Wrap / count How many stays off carton math. Do not invent coverage.
                const stagingPadTakeoff =
                  g.category === "underlayment" && g.unit !== "sheet"
                    ? computeMaterialTakeoff({
                        family: "other",
                        measuredSqft:
                          billedQtyToSqft(g.qty, unitKey === "sqyd" ? "sqyd" : "sqft") ?? 0,
                        wasteAlreadyInQuantity: true,
                        sqftPerBox: Number(g.sqftPerBox) > 0 ? Number(g.sqftPerBox) : null,
                        billingUnit: unitKey === "sqyd" ? "sqyd" : "sqft",
                        takeoffLabel: "Carpet pad",
                      })
                    : null;
                const padRolls = padRollCount(g.category, g.qty, unitKey);
                // Hard surface / exclusive carpet tile pulls by the CARTON from
                // billed area ÷ coverage (sq yd × 9). Wrap / carton TBD / qty TBD
                // How many is already the order. Mixed stretch-in + tile stays cuts.
                const cartonLine = {
                  description: g.name,
                  category: g.category,
                  unit: g.unit,
                  sqft_per_box: g.sqftPerBox,
                  roll_width_ft: g.rollWidthFt,
                  order_as_roll: g.orderAsRoll,
                  quantity: g.qty,
                };
                const cartons = hardSurfaceAreaCartonCount(cartonLine, g.qty);
                const skipCarton = lineSkipsAreaCartonMath({
                  description: g.name,
                  unit: g.unit,
                });
                const showCartonWarn = lineUsesAreaCartonMath(cartonLine);
                const cartonArea =
                  billedQtyToSqft(g.qty, unitKey === "sqyd" ? "sqyd" : "sqft") ?? g.qty;
                const qtyMain = cartons
                  ? `${cartons} carton${cartons === 1 ? "" : "s"}`
                  : stagingPadTakeoff?.cartons
                    ? `${stagingPadTakeoff.cartons.cartonCount} carton${stagingPadTakeoff.cartons.cartonCount === 1 ? "" : "s"}`
                    : padRolls
                      ? `${padRolls} roll${padRolls === 1 ? "" : "s"}`
                      : g.qty > 0
                        ? `${Math.round(g.qty * 100) / 100} ${g.unit || ""}`.trim()
                        : "";
                const qtySub = cartons
                  ? `${Math.round(cartonArea * 100) / 100} sq ft ÷ ${g.sqftPerBox}/box`
                  : stagingPadTakeoff?.cartons
                    ? `${Math.round(cartonArea * 100) / 100} sq ft ÷ ${g.sqftPerBox}/box`
                    : skipCarton
                      ? ""
                      : showCartonWarn
                      ? "⚠ set sq ft/box"
                      : padRolls && unitKey === "sqyd"
                        ? `${Math.round(g.qty * 100) / 100} sq yd ÷ ${PAD_ROLL_SQYD}/roll`
                        : isRoll && g.rollWidthFt
                          ? `${g.rollWidthFt} ft broadloom`
                          : "";
                const manufacturer = topVote(g.mfrVotes);
                const color = topVote(g.colorVotes);
                const supplier = topVote(g.supplierVotes);
                const idTags = [manufacturer, color].filter(Boolean).join(" · ");
                const sourceLabel =
                  g.resolvedSource === "stock"
                    ? "Pull from stock"
                    : g.status === "arrived"
                      ? "Ordered ✓ arrived"
                      : g.status === "partial"
                        ? "Ordered · partial arrival"
                        : `⏳ Order${supplier ? ` · ${supplier}` : ""} — not yet in`;
                return (
                  <tr key={g.key} className="border-b align-top">
                    <td className="py-1.5 pr-2">
                      <span className="inline-block size-4 border border-gray-500" />
                    </td>
                    <td className="py-1.5 px-2">
                      {g.name}
                      {idTags ? (
                        <span className="block text-[11px] text-gray-500">{idTags}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-xs text-gray-600">{sourceLabel}</td>
                    <td className="py-1.5 pl-2 text-right align-top tabular-nums text-gray-700">
                      <div className="font-semibold">{qtyMain}</div>
                      {qtySub ? (
                        <div className="text-[11px] font-normal text-gray-500">{qtySub}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-600">
            No material list linked to this job — check the estimate / notes.
          </p>
        )}
      </div>

      {/* Carpet cut plan — the exact per-piece cuts to pull off the roll (incl.
          fill pieces). Stays piece-by-piece: the warehouse cuts from this, so it
          has to be accurate. */}
      <CarpetCutList
        items={lines.map(
          (m): CutSource => ({
            room: m.room,
            // Prefer the raw line description — it carries the cut text
            // ("… — cuts: 25'6\"×15'") that carpetCutList parses when length_in/
            // width_in aren't set. The clean product name would drop the cuts;
            // carpetCutList strips the "cuts:" suffix for the displayed name.
            description: m.description || m.productName,
            category: m.category,
            length_in: m.lengthIn,
            width_in: m.widthIn,
            sqft: m.sqftArea,
            measurements: m.measurements,
            is_fill: m.isFill,
            roll_width_ft: m.rollWidthFt,
            manufacturer: m.manufacturer,
            color: m.color,
          }),
        )}
        title="Carpet cut plan"
        note="Cut each piece off the roll at the size shown; fill pieces come from the same roll."
      />

      {lines.some((m) => isHardSurfaceCategory(m.category)) ? (
        <div className="mt-3 break-inside-avoid rounded border-2 border-black p-2 text-sm">
          <span className="font-semibold">⚠ Lot / dye lot:</span> verify all cartons
          for each product are the <span className="font-semibold">same lot / dye lot</span>{" "}
          before staging. Do not mix lots.
        </div>
      ) : null}

      {shopNotes.length ? (
        <div className="mt-2 break-inside-avoid border border-black px-2 py-1 text-[12px]">
          <div className="font-bold uppercase tracking-wide">Notes for the shop</div>
          <ul className="mt-0.5 space-y-0.5">
            {shopNotes.map((n, i) => (
              <li key={i}>
                • {n.body}
                <span className="ml-1 text-[10px] text-gray-500">— {n.authorName}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {job.notes ? (
        <div className="mt-4 break-inside-avoid text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
            Staging notes
          </div>
          <p className="whitespace-pre-wrap">{job.notes}</p>
        </div>
      ) : null}

      {/* Sign-off */}
      <div className="mt-10 flex justify-between gap-8 break-inside-avoid text-sm">
        <div className="flex-1">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            Staged &amp; checked by
          </div>
        </div>
        <div className="w-40">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            Date
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-500">
        {org.company_name}
      </div>
    </div>
  );
}

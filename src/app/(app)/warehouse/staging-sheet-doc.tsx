import { PrintLetterhead } from "@/components/print-letterhead";
import { formatDate } from "@/lib/format";
import {
  JOB_DELIVERY_LABELS,
  isRollGoodCategory,
  isHardSurfaceCategory,
  type OrgSettings,
} from "@/lib/types";
import { stripRoomFromName, PAD_ROLL_SQYD, type CutSource } from "@/lib/job-scope";
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
}: {
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
    resolvedSource: JobMaterialLine["resolvedSource"];
    status: JobMaterialLine["status"];
    qty: number;
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
    // Drop the room the questionnaire baked onto the description so the same
    // product in several rooms collapses to one line.
    const name = stripRoomFromName(m.productName || m.description || "Material", m.room);
    const identity = m.productId ?? name.toLowerCase();
    const key = [
      identity,
      m.unit ?? "",
      m.sqftPerBox ?? "",
      m.rollWidthFt ?? "",
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
        resolvedSource: m.resolvedSource,
        status: m.status,
        qty: 0,
        mfrVotes: new Map(),
        colorVotes: new Map(),
        supplierVotes: new Map(),
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.qty += m.qty;
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
                const isHard = isHardSurfaceCategory(g.category);
                const isRoll = isRollGoodCategory(g.category);
                // Padding = underlayment sold by the sq yd → tell the warehouse
                // how many ROLLS to pull (standard PAD_ROLL_SQYD per roll).
                const isPad =
                  g.category === "underlayment" && /yd/i.test(g.unit || "");
                // Hard surface pulls by the CARTON; show the sq-ft basis so the
                // count is verifiable. Roll goods show the total + broadloom width.
                const cartons =
                  isHard && g.sqftPerBox && g.sqftPerBox > 0
                    ? Math.ceil(g.qty / g.sqftPerBox)
                    : 0;
                const padRolls =
                  isPad && g.qty > 0 ? Math.ceil(g.qty / PAD_ROLL_SQYD) : 0;
                const qtyMain = cartons
                  ? `${cartons} carton${cartons === 1 ? "" : "s"}`
                  : padRolls
                    ? `${padRolls} roll${padRolls === 1 ? "" : "s"}`
                    : g.qty > 0
                      ? `${Math.round(g.qty * 100) / 100} ${g.unit || ""}`.trim()
                      : "";
                const qtySub = cartons
                  ? `${Math.round(g.qty * 100) / 100} sq ft ÷ ${g.sqftPerBox}/box`
                  : isHard
                    ? "⚠ set sq ft/box"
                    : padRolls
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
